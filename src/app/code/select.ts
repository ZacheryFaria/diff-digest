// Range selection in the code pane, and which code comments show under which row.
import type { Comment, CommentTarget } from "../../lib/schemas";
import type { CodeLine, ViewRow } from "./rows";

function codeLines(rows: readonly ViewRow[]): readonly CodeLine[] {
    return rows.filter(r => r.kind === "code");
}

function sameSide(a: CodeLine, b: CodeLine): boolean {
    return a.path === b.path && a.rev === b.rev;
}

/** The rows on the same side as `from`, from its line to the line of `to`. */
export function rangeRows(rows: readonly ViewRow[], from: CodeLine, to: CodeLine): readonly CodeLine[] {
    if (!sameSide(from, to)) return [from];
    const lo = Math.min(from.line, to.line);
    const hi = Math.max(from.line, to.line);
    return codeLines(rows).filter(r => sameSide(r, from) && r.line >= lo && r.line <= hi);
}

export const MAX_TARGET_TEXT = 4000;

/** The comment target for a range of rows. */
export function rangeTarget(range: readonly CodeLine[]): CommentTarget | null {
    const [first] = range;
    const last = range.at(-1);
    if (first === undefined || last === undefined) return null;
    const text = range
        .map(r => r.text)
        .join("\n")
        .slice(0, MAX_TARGET_TEXT);
    const base = { kind: "code", path: first.path, rev: first.rev, line: first.line, text } as const;
    return last.line > first.line ? { ...base, endLine: last.line } : base;
}

export interface CodeThreads {
    /** Row key → the comments that show under that row (the last row of their range). */
    readonly byRow: ReadonlyMap<string, readonly Comment[]>;
    /** The keys of rows inside a commented range of two or more lines. */
    readonly ranged: ReadonlySet<string>;
}

export function codeThreads(rows: readonly ViewRow[], comments: readonly Comment[]): CodeThreads {
    const lines = codeLines(rows);
    const byRow = new Map<string, Comment[]>();
    const ranged = new Set<string>();
    for (const c of comments) {
        const t = c.target;
        if (t.kind !== "code") continue;
        const end = t.endLine ?? t.line;
        const hit = lines.filter(r => r.path === t.path && r.rev === t.rev && r.line >= t.line && r.line <= end);
        const last = hit.at(-1);
        if (last === undefined) continue;
        if (end > t.line) for (const r of hit) ranged.add(r.key);
        byRow.set(last.key, [...(byRow.get(last.key) ?? []), c]);
    }
    return { byRow, ranged };
}
