// What a digest describes: a branch, a commit, or a range (ported from bin/diff-digest.mjs).
// PR targets (`#123`, a PR URL) need a backend and come in plan 5.
import { z } from "zod";
import { DigestError } from "../lib/errors";
import { currentBranch, EMPTY_TREE, resolveBase, rev, runGit, short, slug, tryRev } from "../lib/repo";
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

const PR_REF = /^(?:#?\d+|https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+)/u;

function isBranch(root: string, name: string): boolean {
    return [`refs/heads/${name}`, `refs/remotes/origin/${name}`].some(
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
        name: slug(branch === "" ? short(head) : branch),
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
    if (arg.includes("..")) {
        const [a = "", b = ""] = arg.split(/\.{2,3}/u);
        const base = rev(root, a);
        const head = rev(root, b === "" ? "HEAD" : b);
        return {
            kind: "range",
            name: `range-${short(base)}-${short(head)}`,
            branch: "",
            checkedOut: false,
            base,
            head,
        };
    }
    const sha = tryRev(root, arg);
    if (sha === null) throw new DigestError("NOT_FOUND", `Not a branch, commit, or range: ${arg}`);
    if (isBranch(root, arg)) {
        const branch = arg.replace(/^origin\//u, "");
        const checkedOut = branch === currentBranch(root);
        return {
            kind: "branch",
            name: slug(branch),
            branch,
            checkedOut,
            base: resolveBase(root, undefined, sha),
            head: sha,
        };
    }
    return {
        kind: "commit",
        name: `commit-${short(sha)}`,
        branch: "",
        checkedOut: false,
        base: rev(root, `${sha}^`),
        head: sha,
    };
}
