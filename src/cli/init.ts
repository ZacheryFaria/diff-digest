// Creates a digest's working copy with the tool-owned frontmatter, or finds the one that exists.
import { existsSync, readFileSync } from "node:fs";
import { parseDigest, serializeDigest } from "../lib/frontmatter";
import { registerDigest, registryPath } from "../lib/registry";
import { writeAtomic } from "../lib/store";
import { newDigestId, workingCopyFor, type Place } from "./ref";

export interface InitResult {
    readonly id: string;
    readonly path: string;
    readonly created: boolean;
}

/** `base` replaces the target's base in the new frontmatter. A working copy that exists is not changed. */
export function initWorkingCopy(ref: string | undefined, place: Place, base?: string): InitResult {
    const { root, target, mdPath } = workingCopyFor(ref, place, base);
    if (existsSync(mdPath)) {
        const { frontmatter } = parseDigest(readFileSync(mdPath, "utf8"));
        registerDigest({ id: frontmatter.id, mdPath, root }, registryPath(place.home));
        return { id: frontmatter.id, path: mdPath, created: false };
    }
    const id = newDigestId();
    const frontmatter = {
        id,
        branch: target.branch,
        base: target.base,
        // null: the head is the working tree (a checked-out target).
        head: target.checkedOut ? null : target.head,
        pinned: !target.checkedOut,
        // A copy made from a PR keeps the PR, so publish goes to that PR and does not search by branch.
        meta: target.pr === undefined ? {} : { pr: target.pr.url },
    };
    writeAtomic(mdPath, serializeDigest(frontmatter, "\n# Title\n"));
    registerDigest({ id, mdPath, root }, registryPath(place.home));
    return { id, path: mdPath, created: true };
}
