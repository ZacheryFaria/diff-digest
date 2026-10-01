import { basename } from "node:path";
import { DigestError } from "./errors";
import { ShaSchema, type Sha } from "./schemas";

/** git's empty tree. It is the base in a repo that has no commits yet. */
export const EMPTY_TREE: Sha = ShaSchema.parse("4b825dc642cb6eb9a060e54bf8d69288fbee4904");

/** "worktree" means the working tree, including untracked files. */
export type Head = "worktree" | Sha;

export interface RepoContext {
    readonly root: string;
    readonly base: Sha;
    readonly head: Head;
}

export interface GitResult {
    readonly ok: boolean;
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

export interface OriginRepo {
    readonly host: string;
    readonly owner: string;
    readonly repo: string;
}

/** Runs git and returns the result. It never throws for a non-zero exit. */
export function runGit(root: string, args: readonly string[], input?: string): GitResult {
    const result = Bun.spawnSync(["git", ...args], {
        cwd: root,
        stdin: input === undefined ? "ignore" : Buffer.from(input),
        stdout: "pipe",
        stderr: "pipe",
    });
    return {
        ok: result.exitCode === 0,
        code: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
    };
}

/** Runs git and returns stdout. Throws GIT_FAILED for a non-zero exit. */
export function git(root: string, args: readonly string[], input?: string): string {
    const result = runGit(root, args, input);
    if (!result.ok) {
        throw new DigestError("GIT_FAILED", `git ${args.join(" ")} failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
}

export function findRepoRoot(cwd: string): string {
    const result = runGit(cwd, ["rev-parse", "--show-toplevel"]);
    if (!result.ok) throw new DigestError("NOT_FOUND", `${cwd} is not in a git repo.`);
    return result.stdout.trim();
}

export function tryRev(root: string, ref: string): Sha | null {
    if (ref === EMPTY_TREE) return EMPTY_TREE;
    if (ref === "") return null;
    const result = runGit(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return result.ok ? ShaSchema.parse(result.stdout.trim()) : null;
}

export function rev(root: string, ref: string): Sha {
    const sha = tryRev(root, ref);
    if (sha === null) throw new DigestError("NOT_FOUND", `Not a commit: ${ref}`);
    return sha;
}

export function hasCommit(root: string, sha: string): boolean {
    return sha !== "" && runGit(root, ["cat-file", "-e", `${sha}^{commit}`]).ok;
}

export function mergeBase(root: string, a: string, b: string): Sha {
    return ShaSchema.parse(git(root, ["merge-base", a, b]).trim());
}

/** The current branch name, or "" when HEAD is detached. */
export function currentBranch(root: string): string {
    return git(root, ["branch", "--show-current"]).trim();
}

/** The merge-base with the remote default branch, or the empty tree in a repo with no commits. */
export function resolveBase(root: string, ref?: string, head = "HEAD"): Sha {
    if (ref !== undefined) return rev(root, ref);
    if (head === "HEAD" && tryRev(root, "HEAD") === null) return EMPTY_TREE;
    for (const branch of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
        const result = runGit(root, ["merge-base", head, branch]);
        if (result.ok) return ShaSchema.parse(result.stdout.trim());
    }
    throw new DigestError("NOT_FOUND", "No base found.", { hint: "Give a base ref." });
}

const ORIGIN = /^(?:ssh:\/\/)?(?:git@|https?:\/\/)([^:/]+)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/u;

export function originRepo(root: string): OriginRepo | null {
    const result = runGit(root, ["remote", "get-url", "origin"]);
    if (!result.ok) return null;
    const match = ORIGIN.exec(result.stdout.trim());
    if (match === null) return null;
    const [, host, owner, repo] = match;
    if (host === undefined || owner === undefined || repo === undefined) return null;
    return { host, owner, repo };
}

/** The keys that a repo entry in the config can use: the repo name, then host/owner/name. */
export function repoKeys(root: string): readonly [string, ...string[]] {
    const origin = originRepo(root);
    if (origin === null) return [basename(root)];
    return [origin.repo, `${origin.host}/${origin.owner}/${origin.repo}`];
}

export function short(sha: string): string {
    return sha.slice(0, 11);
}

export function slug(value: string): string {
    return value.replaceAll(/[^\w.-]+/gu, "-");
}
