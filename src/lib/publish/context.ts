// What every publish step needs: the chosen backends, where each one puts the digest, and link rules.
import { basename } from "node:path";
import { parsePrUrl } from "../backends/pr";
import { backendsFor } from "../backends/registry";
import type { Backend, BackendDeps, LinkContext, LocateInput, Location, PrInfo } from "../backends/types";
import { findFile } from "../digest";
import { resolveTracked } from "../files";
import type { OpenDigest } from "../payload";
import { repoKeys, tryRev } from "../repo";
import { failureOf, type BackendFailure } from "./failures";

export interface Placed {
    readonly backend: Backend;
    readonly location: Location;
}

/** The PR in the frontmatter `meta.pr` (written for a working copy made from a PR), when it is a PR URL. */
function metaPr(open: OpenDigest): ReturnType<typeof parsePrUrl> {
    const value = open.frontmatter.meta["pr"];
    return typeof value === "string" ? parsePrUrl(value) : null;
}

export function locateInput(open: OpenDigest, pr: PrInfo | null): LocateInput {
    return {
        root: open.entry.root,
        repo: repoKeys(open.entry.root)[0],
        name: basename(open.entry.mdPath, ".md"),
        branch: open.frontmatter.branch,
        pr,
        prRef: metaPr(open),
    };
}

/** The commit that links point at: the pinned head, or the commit under the working tree. */
export function linkHead(open: OpenDigest): string {
    return open.ctx.head === "worktree" ? (tryRev(open.entry.root, "HEAD") ?? "") : open.ctx.head;
}

export function linkContext(open: OpenDigest, location: Location, head: string = linkHead(open)): LinkContext {
    return {
        root: open.entry.root,
        head,
        resolvePath: suffix => findFile(open.files, suffix)?.path ?? resolveTracked(open.ctx, suffix) ?? null,
        pr: location.type === "github" ? location.pr : null,
    };
}

/** Why a backend has no place for the digest. */
function skipReason(backend: Backend): string {
    return backend.type === "github"
        ? `${backend.name}: no PR for the branch.`
        : `${backend.name}: no place for this digest.`;
}

export interface Placement {
    readonly placed: Placed[];
    /** Backends that had no place for the digest. */
    readonly skipped: string[];
    /** Backends that failed to find a place (for example, gh is not installed). */
    readonly failed: BackendFailure[];
}

/** Each backend with its location. A backend that cannot take this digest is in `skipped`; an error is in `failed`. */
export async function place(backends: readonly Backend[], input: LocateInput): Promise<Placement> {
    const found = await Promise.allSettled(backends.map(backend => backend.locate(input)));
    const out: Placement = { placed: [], skipped: [], failed: [] };
    for (const [i, f] of found.entries()) {
        const backend = backends[i];
        if (backend === undefined) continue;
        if (f.status === "rejected") out.failed.push(failureOf(backend.name, f.reason));
        else if (f.value === null) out.skipped.push(skipReason(backend));
        else out.placed.push({ backend, location: f.value });
    }
    return out;
}

/** The chosen backends (`names`, or the config's publishTo) placed for the digest. `chosen` is their count. */
export async function placeFor(
    open: OpenDigest,
    names: readonly string[],
    home: string | undefined,
    deps: BackendDeps,
): Promise<Placement & { readonly chosen: number }> {
    const backends = backendsFor(open.entry.root, names, home, deps);
    return { ...(await place(backends, locateInput(open, null))), chosen: backends.length };
}
