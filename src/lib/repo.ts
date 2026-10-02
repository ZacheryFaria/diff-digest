import { existsSync } from "node:fs";
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

/** Runs git and returns the result. It never throws for a non-zero exit. A missing `root` is NOT_FOUND. */
export function runGit(root: string, args: readonly string[], input?: string): GitResult {
    if (!existsSync(root)) throw new DigestError("NOT_FOUND", `The folder ${root} does not exist.`);
    const result = Bun.spawnSync(["git", "-c", "color.ui=never", ...args], {
        cwd: root,
        // A fetch from a new HTTPS remote must fail, not wait for a password on the terminal.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
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

/** The scp form `git@host:owner/repo[.git]`. Other users and SSH host aliases stay unparsed, as before. */
const SCP_ORIGIN = /^git@([^:/]+):(?!\/)(.+)$/u;
const URL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "ssh:"]);

function ownerAndRepo(host: string, path: string): OriginRepo | null {
    const [owner, ...rest] = path
        .replace(/^\/+/u, "")
        .replace(/\/+$/u, "")
        .replace(/\.git$/u, "")
        .split("/");
    const repo = rest.join("/");
    return owner === undefined || owner === "" || repo === "" ? null : { host, owner, repo };
}

/**
 * The host, owner, and repo of a remote URL. A URL form (`https:`, `ssh:`, `git:`) keeps only the host
 * name and the path, so a user name, a token, or a port never goes into a link.
 */
export function parseOrigin(url: string): OriginRepo | null {
    if (url.includes("://")) {
        if (!URL.canParse(url)) return null;
        const parsed = new URL(url);
        return parsed.hostname === "" || !URL_SCHEMES.has(parsed.protocol)
            ? null
            : ownerAndRepo(parsed.hostname, decodeURIComponent(parsed.pathname));
    }
    const scp = SCP_ORIGIN.exec(url);
    if (scp === null) return null;
    const [, host = "", path = ""] = scp;
    return ownerAndRepo(host, path);
}

export function originRepo(root: string): OriginRepo | null {
    const result = runGit(root, ["remote", "get-url", "origin"]);
    if (!result.ok) return null;
    return parseOrigin(result.stdout.trim());
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
