// What every publish step needs: the chosen backends, where each one puts the digest, and link rules.
import { basename } from "node:path";
import { chooseBackends } from "../backends/registry";
import type { Backend, BackendDeps, LinkContext, LocateInput, Location, PrInfo } from "../backends/types";
import { readConfigFile, resolveConfig } from "../config";
import { findFile } from "../digest";
import { resolveTracked } from "../files";
import type { OpenDigest } from "../payload";
import { configPath } from "../paths";
import { repoKeys, tryRev } from "../repo";

export interface Placed {
    readonly backend: Backend;
    readonly location: Location;
}

export function backendsFor(
    root: string,
    names: readonly string[],
    home: string | undefined,
    deps: BackendDeps,
): Backend[] {
    return chooseBackends(names, resolveConfig(readConfigFile(configPath(home)), repoKeys(root)), deps);
}

export function locateInput(open: OpenDigest, pr: PrInfo | null): LocateInput {
    return {
        root: open.entry.root,
        repo: repoKeys(open.entry.root)[0],
        name: basename(open.entry.mdPath, ".md"),
        branch: open.frontmatter.branch,
        pr,
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

/** Each backend with its location; a backend that cannot take this digest is in `skipped`. */
export async function place(
    backends: readonly Backend[],
    input: LocateInput,
): Promise<{ placed: Placed[]; skipped: string[] }> {
    const found = await Promise.all(
        backends.map(async backend => ({ backend, location: await backend.locate(input) })),
    );
    const placed: Placed[] = [];
    const skipped: string[] = [];
    for (const f of found) {
        if (f.location === null)
            skipped.push(`${f.backend.name}: no place for this digest (for github: no PR for the branch).`);
        else placed.push({ backend: f.backend, location: f.location });
    }
    return { placed, skipped };
}
