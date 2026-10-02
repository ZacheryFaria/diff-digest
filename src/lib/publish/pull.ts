// `pull`: write the working copy from the first backend that has the digest for the target.
import { existsSync } from "node:fs";
import type { BackendDeps, PrInfo } from "../backends/types";
import { DigestError } from "../errors";
import { serializeDigest } from "../frontmatter";
import { registerDigest, registryPath } from "../registry";
import { hasCommit, repoKeys, runGit } from "../repo";
import type { Sha } from "../schemas";
import { workingCopyPath, writeAtomic } from "../store";
import { backendsFor, findPulled } from "./find";
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

/** True when the clone has `sha`, after a fetch from origin when it did not. */
function ensureCommit(root: string, sha: string): boolean {
    if (hasCommit(root, sha)) return true;
    runGit(root, ["fetch", "-q", "origin", sha]);
    return hasCommit(root, sha);
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
    const input = { root, repo, name: target.name, branch: target.branch, pr: target.pr ?? null };
    const found = await findPulled(backendsFor(root, options.from, options.home, deps), input);
    const { meta, body, ref } = found.pulled;
    const headMissing = !target.checkedOut && meta.head !== null && !ensureCommit(root, meta.head);
    const frontmatter = {
        id: meta.id,
        branch: meta.branch,
        base: meta.base,
        head: target.checkedOut ? null : headMissing ? target.head : meta.head,
        pinned: !target.checkedOut,
        meta: target.pr === undefined ? {} : { pr: target.pr.url },
    };
    writeAtomic(mdPath, serializeDigest(frontmatter, body));
    registerDigest({ id: meta.id, mdPath, root }, registryPath(options.home));
    const stale = headMissing || (meta.head !== null && target.head !== null && meta.head !== target.head);
    return { path: mdPath, backend: found.backend, ref, stale, headMissing };
}
