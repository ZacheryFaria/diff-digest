// `pull`: write the working copy from the first backend that has the digest for the target.
import { existsSync } from "node:fs";
import type { Backend, BackendDeps, LocateInput, PrInfo, Pulled } from "../backends/types";
import { DigestError } from "../errors";
import { serializeDigest } from "../frontmatter";
import { registerDigest, registryPath } from "../registry";
import { repoKeys } from "../repo";
import type { Sha } from "../schemas";
import { workingCopyPath, writeAtomic } from "../store";
import { backendsFor } from "./context";
import type { PullReport } from "./schemas";

/** What `pull` needs from a target (the CLI's `Target` has these fields). */
export interface PullTarget {
    readonly name: string;
    readonly branch: string;
    readonly checkedOut: boolean;
    readonly head: Sha | null;
    readonly pr?: PrInfo | undefined;
}

export interface PullOptions {
    readonly from: readonly string[];
    readonly force: boolean;
    readonly home: string;
}

/** Tries each backend in order and stops at the first one that has the digest. */
async function firstPull(
    backends: readonly Backend[],
    input: LocateInput,
    index = 0,
): Promise<{ readonly backend: string; readonly pulled: Pulled } | null> {
    const backend = backends[index];
    if (backend === undefined) return null;
    const location = await backend.locate(input);
    const pulled = location === null ? null : await backend.pull(location);
    return pulled === null ? firstPull(backends, input, index + 1) : { backend: backend.name, pulled };
}

export async function pullDigest(
    root: string,
    target: PullTarget,
    options: PullOptions,
    deps: BackendDeps,
): Promise<PullReport> {
    const repo = repoKeys(root)[0];
    const mdPath = workingCopyPath(repo, target.name, options.home);
    if (existsSync(mdPath) && !options.force) {
        throw new DigestError("BAD_INPUT", `${mdPath} already exists.`, {
            hint: "Use it, or pull again with --force to replace it.",
        });
    }
    const found = await firstPull(backendsFor(root, options.from, options.home, deps), {
        root,
        repo,
        name: target.name,
        branch: target.branch,
        pr: target.pr ?? null,
    });
    if (found === null)
        throw new DigestError("NOT_FOUND", `No backend has a digest for ${target.name}.`, {
            hint: "Make one with `diff-digest init`.",
        });
    const { meta, body, ref } = found.pulled;
    const frontmatter = {
        id: meta.id,
        branch: meta.branch,
        base: meta.base,
        head: target.checkedOut ? null : meta.head,
        pinned: !target.checkedOut,
        meta: {},
    };
    writeAtomic(mdPath, serializeDigest(frontmatter, body));
    registerDigest({ id: meta.id, mdPath, root }, registryPath(options.home));
    const stale = meta.head !== null && target.head !== null && meta.head !== target.head;
    return { path: mdPath, backend: found.backend, ref, stale };
}
