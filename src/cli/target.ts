// What a digest describes: a branch, a commit, or a range (ported from bin/diff-digest.mjs).
// PR targets (`#123`, a PR URL) need a backend and come in plan 5.
import { z } from "zod";
import { DigestError } from "../lib/errors";
import { currentBranch, EMPTY_TREE, mergeBase, resolveBase, rev, runGit, short, slug, tryRev } from "../lib/repo";
import { ShaSchema } from "../lib/schemas";

export const TargetSchema = z
    .strictObject({
        kind: z.enum(["branch", "commit", "range"]),
        /** The working copy file name (without .md). */
        name: z.string().min(1),
        branch: z.string(),
        /** True when the target is the checked-out branch: the head is the working tree. */
        checkedOut: z.boolean(),
        base: ShaSchema,
        /** The head commit, or null in a repo with no commits. */
        head: ShaSchema.nullable(),
    })
    .readonly();
export type Target = z.infer<typeof TargetSchema>;

const PR_REF = /^(?:#?\d+|https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+\/?)$/u;

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

export function resolveTarget(root: string, arg?: string): Target {
    if (arg === undefined || arg === "") return current(root);
    if (PR_REF.test(arg)) {
        throw new DigestError("BAD_INPUT", `PR targets are not supported yet: ${arg}`, {
            hint: "Give the PR's branch name.",
        });
    }
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
