// What a digest describes: a PR, a branch, a commit, or a range (ported from bin/diff-digest.mjs).
import { z } from "zod";
import { realDeps } from "../lib/backends/deps";
import { ensurePrCommits, parsePrRef, prInfo, type PrRef } from "../lib/backends/pr";
import { PrInfoSchema, type PrInfo } from "../lib/backends/types";
import { DigestError } from "../lib/errors";
import { currentBranch, EMPTY_TREE, mergeBase, resolveBase, rev, runGit, short, slug, tryRev } from "../lib/repo";
import { ShaSchema } from "../lib/schemas";

export const TargetSchema = z
    .strictObject({
        kind: z.enum(["pr", "branch", "commit", "range"]),
        /** The working copy file name (without .md). */
        name: z.string().min(1),
        branch: z.string(),
        /** True when the target is the checked-out branch: the head is the working tree. */
        checkedOut: z.boolean(),
        base: ShaSchema,
        /** The head commit, or null in a repo with no commits. */
        head: ShaSchema.nullable(),
        /** The PR, for a PR target. */
        pr: PrInfoSchema.optional(),
    })
    .readonly();
export type Target = z.infer<typeof TargetSchema>;

/** Reads a PR (with gh, by default). Tests give a fake. */
export type PrLookup = (ref: PrRef, root: string) => PrInfo;

const ghLookup: PrLookup = (ref, root) => prInfo(realDeps, ref, root);

/** A PR: checked out when its head branch is the current branch, else pinned to the PR head. */
function prTarget(root: string, pr: PrInfo): Target {
    ensurePrCommits(root, pr);
    const checkedOut = pr.headRef === currentBranch(root);
    const base = checkedOut ? resolveBase(root) : mergeBase(root, pr.baseSha, pr.headSha);
    return { kind: "pr", name: slug(pr.headRef), branch: pr.headRef, checkedOut, base, head: pr.headSha, pr };
}

/** The full ref of a local branch, or else of a branch on origin. `origin/` in front is optional. */
function branchRef(root: string, branch: string): string | undefined {
    return [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`].find(
        r => runGit(root, ["show-ref", "--verify", "--quiet", r]).ok,
    );
}

function current(root: string): Target {
    const branch = currentBranch(root);
    const head = tryRev(root, "HEAD");
    if (head === null)
        return {
            kind: "branch",
            name: slug(branch === "" ? "main" : branch),
            branch,
            checkedOut: true,
            base: EMPTY_TREE,
            head: null,
        };
    return {
        kind: "branch",
        // A detached HEAD is named for its commit, so the name stays the same for that commit.
        name: branch === "" ? `commit-${short(head)}` : slug(branch),
        branch,
        checkedOut: true,
        base: resolveBase(root),
        head,
    };
}

export function resolveTarget(root: string, arg?: string, lookupPr: PrLookup = ghLookup): Target {
    if (arg === undefined || arg === "") return current(root);
    const prRef = parsePrRef(arg, root);
    if (prRef !== null) return prTarget(root, lookupPr(prRef, root));
    if (arg.includes("..")) return range(root, arg);
    const branch = arg.replace(/^origin\//u, "");
    const ref = branchRef(root, branch);
    if (ref !== undefined) {
        const sha = rev(root, ref);
        return {
            kind: "branch",
            name: slug(branch),
            branch,
            checkedOut: ref.startsWith("refs/heads/") && branch === currentBranch(root),
            base: resolveBase(root, undefined, sha),
            head: sha,
        };
    }
    const sha = tryRev(root, arg);
    if (sha === null) throw new DigestError("NOT_FOUND", `Not a branch, commit, or range: ${arg}`);
    return {
        kind: "commit",
        name: `commit-${short(sha)}`,
        branch: "",
        checkedOut: false,
        // A root commit has no parent: its base is the empty tree.
        base: tryRev(root, `${sha}^`) ?? EMPTY_TREE,
        head: sha,
    };
}

/** `a..b` has the base `a`; `a...b` has the merge-base of `a` and `b`. An empty `b` is HEAD. */
function range(root: string, arg: string): Target {
    const [a = "", b = ""] = arg.split(/\.{2,3}/u);
    const head = rev(root, b === "" ? "HEAD" : b);
    const base = arg.includes("...") ? mergeBase(root, rev(root, a), head) : rev(root, a);
    return {
        kind: "range",
        name: `range-${short(base)}-${short(head)}`,
        branch: "",
        checkedOut: false,
        base,
        head,
    };
}
