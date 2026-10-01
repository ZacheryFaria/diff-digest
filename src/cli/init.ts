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

export function initWorkingCopy(ref: string | undefined, place: Place): InitResult {
    const { root, target, mdPath } = workingCopyFor(ref, place);
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
        head: target.head,
        pinned: !target.checkedOut,
        meta: {},
    };
    writeAtomic(mdPath, serializeDigest(frontmatter, "\n# Title\n"));
    registerDigest({ id, mdPath, root }, registryPath(place.home));
    return { id, path: mdPath, created: true };
}
