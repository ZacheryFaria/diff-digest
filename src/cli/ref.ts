// Which digest a command works on (spec §5.2): nothing (the current branch), a target, an id, or a path.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DigestError } from "../lib/errors";
import { parseDigest } from "../lib/frontmatter";
import { findDigest, readRegistry, registerDigest, registryPath } from "../lib/registry";
import { findRepoRoot, repoKeys, rev } from "../lib/repo";
import type { RegistryEntry } from "../lib/schemas-api";
import { workingCopyPath } from "../lib/store";
import { resolveTarget, type Target } from "./target";

export interface RefInput {
    readonly ref?: string | undefined;
    readonly id?: string | undefined;
}

export interface Place {
    readonly cwd: string;
    readonly home: string;
}

export interface WorkingCopy {
    readonly root: string;
    readonly target: Target;
    readonly mdPath: string;
}

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newDigestId(): string {
    return Array.from(randomBytes(8), b => ID_ALPHABET[b % ID_ALPHABET.length] ?? "0").join("");
}

/**
 * The repo, the target, and the working copy path for a target reference (the file can be missing).
 * `base` replaces the target's base (for example the parent of a stacked branch).
 */
export function workingCopyFor(ref: string | undefined, place: Place, base?: string): WorkingCopy {
    const root = findRepoRoot(place.cwd);
    const resolved = resolveTarget(root, ref);
    const target = base === undefined ? resolved : { ...resolved, base: rev(root, base) };
    return { root, target, mdPath: workingCopyPath(repoKeys(root)[0], target.name, place.home) };
}

/**
 * The registry entry for a working copy. For a `.md` path ref the cwd does not prove the repo, so an
 * entry with the same id and path is used as it is, and only a new or moved digest is registered with
 * `root()`. For a target ref the root is known (`known: true`), so a stale root is replaced.
 */
function register(mdPath: string, root: () => string, home: string, known = false): RegistryEntry {
    const { frontmatter } = parseDigest(readFileSync(mdPath, "utf8"));
    const path = registryPath(home);
    const entry = readRegistry(path).digests[frontmatter.id];
    if (entry?.mdPath === mdPath && (!known || entry.root === root())) return entry;
    return registerDigest({ id: frontmatter.id, mdPath, root: root() }, path);
}

/** The registered digest for a reference. A target or a path is registered, so the server can find it. */
export function resolveDigest(input: RefInput, place: Place): RegistryEntry {
    if (input.id !== undefined) {
        if (input.ref !== undefined) throw new DigestError("BAD_INPUT", "Give a digest id or a ref, not both.");
        return findDigest(input.id, registryPath(place.home));
    }
    if (input.ref?.endsWith(".md") === true) {
        const mdPath = resolve(place.cwd, input.ref);
        if (!existsSync(mdPath)) throw new DigestError("NOT_FOUND", `${mdPath} does not exist.`);
        return register(mdPath, () => findRepoRoot(place.cwd), place.home);
    }
    const copy = workingCopyFor(input.ref, place);
    if (!existsSync(copy.mdPath)) {
        throw new DigestError("NOT_FOUND", `No digest for ${copy.target.name}.`, {
            hint: "Create it with `diff-digest init`.",
        });
    }
    return register(copy.mdPath, () => copy.root, place.home, true);
}
