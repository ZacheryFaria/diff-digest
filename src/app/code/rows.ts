// The rows of the code pane, for the Diff view and for the After and Before views (ported from the old tool).
import type { DiffPayload, FilePayload, FileSide, HunkSummary } from "../../lib/schemas-api";
import { diffRows } from "./diff";

export interface CodeLine {
    readonly kind: "code";
    readonly key: string;
    readonly path: string;
    readonly rev: FileSide;
    readonly line: number;
    readonly text: string;
    /** The line-number cells: two in the Diff view, one in a file view. */
    readonly numbers: readonly string[];
    /** The diff sign, or null in a file view. */
    readonly sign: string | null;
    readonly classes: readonly string[];
}

export type ViewRow = { readonly kind: "hunk"; readonly key: string; readonly text: string } | CodeLine;

/** The lines that the digest anchor points at, or nothing. */
export interface Anchor {
    readonly start?: number | undefined;
    readonly end?: number | undefined;
}

function codeLine(
    path: string,
    rev: FileSide,
    line: number,
    text: string,
    parts: Pick<CodeLine, "numbers" | "sign" | "classes">,
): CodeLine {
    return { kind: "code", key: `${rev}:${path}:${line}`, path, rev, line, text, ...parts };
}

/** Mark each group of rows (by key) as a focused hunk, with a top and a bottom edge. */
function focus<T extends ViewRow>(rows: readonly T[], groups: readonly (readonly string[])[]): readonly T[] {
    const extra = new Map<string, string[]>();
    for (const keys of groups)
        keys.forEach((key, i) => {
            extra.set(key, [
                "hunk-focus",
                ...(i === 0 ? ["hunk-top"] : []),
                ...(i === keys.length - 1 ? ["hunk-bottom"] : []),
            ]);
        });
    return rows.map(r => {
        const more = extra.get(r.key);
        return r.kind === "code" && more !== undefined ? { ...r, classes: [...r.classes, ...more] } : r;
    });
}

function near(lo: number, hi: number, anchor: Anchor): boolean {
    if (anchor.start === undefined) return false;
    return lo <= (anchor.end ?? anchor.start) + 1 && hi >= anchor.start - 1;
}

function inAnchor(n: number, anchor: Anchor): boolean {
    return anchor.start !== undefined && n >= anchor.start && n <= (anchor.end ?? anchor.start);
}

const SIGN_CLASS = { "+": ["added"], "-": ["removed"], " ": [] } as const;

export function diffView(payload: DiffPayload, anchor: Anchor): readonly ViewRow[] {
    const out: ViewRow[] = [];
    const groups: string[][] = [];
    let group: string[] | null = null;
    for (const row of diffRows(payload.text)) {
        if (row.kind === "hunk") {
            group = near(row.newStart, row.newEnd, anchor) ? [] : null;
            if (group !== null) groups.push(group);
            out.push({ kind: "hunk", key: `hunk:${out.length}`, text: row.text });
            continue;
        }
        const old = row.sign === "-";
        const line = (old ? row.oldN : row.newN) ?? 0;
        const c = codeLine(old ? payload.oldPath : payload.path, old ? "base" : "head", line, row.text, {
            numbers: [String(row.oldN ?? ""), String(row.newN ?? "")],
            sign: row.sign,
            classes: SIGN_CLASS[row.sign],
        });
        group?.push(c.key);
        out.push(c);
    }
    return focus(out, groups);
}

function hunkEnd(h: HunkSummary): number {
    return h.newCount > 0 ? h.newStart + h.newCount - 1 : h.newStart + 1;
}

function removedRows(file: FilePayload, h: HunkSummary): readonly CodeLine[] {
    return h.removed.map(l =>
        codeLine(file.oldPath, "base", l.n, l.text, {
            numbers: [`−${l.n}`],
            sign: null,
            classes: ["removed", "inline-old"],
        }),
    );
}

/** In the After view, the removed lines of each anchored hunk show inline, above their replacement. */
function inlineOld(
    file: FilePayload,
    related: readonly HunkSummary[],
): {
    readonly before: ReadonlyMap<number, HunkSummary>;
    readonly after: ReadonlyMap<number, HunkSummary>;
} {
    const before = new Map<number, HunkSummary>();
    const after = new Map<number, HunkSummary>();
    if (file.rev === "head")
        for (const h of related.filter(r => r.removed.length > 0)) {
            const [first] = h.added;
            if (first === undefined) after.set(h.newStart, h);
            else before.set(first, h);
        }
    return { before, after };
}

function lineClasses(file: FilePayload, n: number, anchor: Anchor, related: boolean): readonly string[] {
    const mark = file.marks[String(n)];
    const anchored = file.rev === "head" && inAnchor(n, anchor);
    return [...(mark === undefined ? [] : [mark]), ...(anchored ? [related ? "anchor-range" : "focus"] : [])];
}

export function fileView(file: FilePayload, anchor: Anchor): readonly ViewRow[] {
    const related = file.hunks.filter(h => near(h.newStart, hunkEnd(h), anchor));
    const { before, after } = inlineOld(file, related);
    const byHunk = new Map<HunkSummary, string[]>(related.map(h => [h, []]));
    const out: CodeLine[] = [];
    const push = (h: HunkSummary | undefined, rows: readonly CodeLine[]): void => {
        if (h !== undefined) byHunk.get(h)?.push(...rows.map(r => r.key));
        out.push(...rows);
    };
    const inline = (h: HunkSummary | undefined): void => {
        if (h !== undefined) push(h, removedRows(file, h));
    };
    const hunkOf = (n: number): HunkSummary | undefined =>
        related.find(h => (file.rev === "head" ? h.added.includes(n) : h.removed.some(l => l.n === n)));
    inline(after.get(0));
    file.text
        .replace(/\n$/u, "")
        .split("\n")
        .forEach((text, i) => {
            const n = i + 1;
            inline(before.get(n));
            const classes = lineClasses(file, n, anchor, related.length > 0);
            push(hunkOf(n), [codeLine(file.path, file.rev, n, text, { numbers: [String(n)], sign: null, classes })]);
            inline(after.get(n));
        });
    return focus(out, [...byHunk.values()]);
}
