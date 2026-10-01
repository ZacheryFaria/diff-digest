// Which digest a command works on (spec §5.2): nothing (the current branch), a target, an id, or a path.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DigestError } from "../lib/errors";
import { parseDigest } from "../lib/frontmatter";
import { findDigest, registerDigest, registryPath } from "../lib/registry";
import { findRepoRoot, repoKeys } from "../lib/repo";
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

/** The repo, the target, and the working copy path for a target reference (the file can be missing). */
export function workingCopyFor(ref: string | undefined, place: Place): WorkingCopy {
    const root = findRepoRoot(place.cwd);
    const target = resolveTarget(root, ref);
    return { root, target, mdPath: workingCopyPath(repoKeys(root)[0], target.name, place.home) };
}

function register(mdPath: string, root: string, home: string): RegistryEntry {
    const { frontmatter } = parseDigest(readFileSync(mdPath, "utf8"));
    return registerDigest({ id: frontmatter.id, mdPath, root }, registryPath(home));
}

/** The registered digest for a reference. A target or a path is registered, so the server can find it. */
export function resolveDigest(input: RefInput, place: Place): RegistryEntry {
    if (input.id !== undefined) return findDigest(input.id, registryPath(place.home));
    if (input.ref?.endsWith(".md") === true) {
        const mdPath = resolve(place.cwd, input.ref);
        if (!existsSync(mdPath)) throw new DigestError("NOT_FOUND", `${mdPath} does not exist.`);
        return register(mdPath, findRepoRoot(place.cwd), place.home);
    }
    const copy = workingCopyFor(input.ref, place);
    if (!existsSync(copy.mdPath)) {
        throw new DigestError("NOT_FOUND", `No digest for ${copy.target.name}.`, {
            hint: "Create it with `diff-digest init`.",
        });
    }
    return register(copy.mdPath, copy.root, place.home);
}
