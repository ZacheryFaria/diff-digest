// The code views for one changed (or unchanged) file: the diff, and the file before or after.
import { findFile } from "./digest";
import { newExists, newText, parseDiff, rawDiff } from "./diff";
import { git, runGit, type RepoContext } from "./repo";
import type { ChangedFile, Hunk } from "./schemas";
import type { DiffPayload, FilePayload, FileSide, HunkSummary, LineMark } from "./schemas-api";

/** The one tracked file that matches a path suffix at the head, or undefined. */
export function resolveTracked(ctx: RepoContext, suffix: string): string | undefined {
    if (suffix === "" || suffix.includes("..")) return undefined;
    const list = ctx.head === "worktree" ? ["ls-files"] : ["ls-tree", "-r", "--name-only", ctx.head];
    const hits = runGit(ctx.root, [...list, "--", suffix, `**/${suffix}`])
        .stdout.split("\n")
        .filter(l => l !== "");
    return hits.length === 1 ? hits[0] : undefined;
}

function summary(hunks: readonly Hunk[]): HunkSummary[] {
    return hunks.map(h => ({
        oldStart: h.oldStart,
        oldCount: h.oldCount,
        newStart: h.newStart,
        newCount: h.newCount,
        added: h.added.map(l => l.n),
        removed: h.removed,
    }));
}

export function diffPayload(ctx: RepoContext, files: readonly ChangedFile[], suffix: string): DiffPayload {
    const file = findFile(files, suffix);
    if (file === undefined) {
        const path = resolveTracked(ctx, suffix) ?? suffix;
        return { path, oldPath: path, text: "", unchanged: true };
    }
    return { path: file.path, oldPath: file.oldPath, text: rawDiff(ctx, file, 3), unchanged: false };
}

function headMarks(hunks: readonly Hunk[]): Record<string, LineMark> {
    const marks: Record<string, LineMark> = {};
    for (const h of hunks) {
        for (const l of h.added) marks[String(l.n)] = h.removed.length > 0 ? "changed" : "added";
        if (h.added.length === 0) marks[String(h.start)] ??= "deleted-after";
    }
    return marks;
}

function baseMarks(hunks: readonly Hunk[]): Record<string, LineMark> {
    const marks: Record<string, LineMark> = {};
    for (const h of hunks) for (const l of h.removed) marks[String(l.n)] = "removed";
    return marks;
}

/** The full file before (`base`) or after (`head`) the change, with the changed lines marked. */
export function filePayload(
    ctx: RepoContext,
    files: readonly ChangedFile[],
    suffix: string,
    side: FileSide,
): FilePayload {
    const file = findFile(files, suffix);
    const path = file?.path ?? resolveTracked(ctx, suffix);
    if (path === undefined) {
        return {
            path: suffix,
            oldPath: suffix,
            rev: side,
            text: "",
            marks: {},
            hunks: [],
            unchanged: true,
            error: `No file matches ${suffix}`,
        };
    }
    const oldPath = file?.oldPath ?? path;
    const hunks = file === undefined ? [] : parseDiff(rawDiff(ctx, file));
    const base = { oldPath, rev: side, hunks: summary(hunks), unchanged: file === undefined };
    if (side === "base") {
        if (file?.status === "A") return { ...base, path, text: "", marks: {}, error: "Added in this change" };
        return {
            ...base,
            path: oldPath,
            text: git(ctx.root, ["show", `${ctx.base}:${oldPath}`]),
            marks: baseMarks(hunks),
        };
    }
    if (!newExists(ctx, path)) return { ...base, path, text: "", marks: {}, error: "Deleted in this change" };
    return { ...base, path, text: newText(ctx, path), marks: headMarks(hunks) };
}
