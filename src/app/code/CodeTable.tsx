// The code rows with line and range comments: press + on a line and drag to another line on the same side.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Comment, CommentTarget } from "../../lib/schemas";
import { Composer, Thread } from "../components/Thread";
import { highlightLine } from "../highlight";
import { useApp } from "../state/context";
import type { CodeLine, ViewRow } from "./rows";
import { classes } from "../classes";
import { codeThreads, dragTo, focusKey, rangeRows, rangeTarget } from "./select";

interface Drag {
    readonly from: CodeLine;
    readonly to: CodeLine;
}

interface Draft {
    readonly keys: readonly string[];
    readonly after: string;
    readonly target: CommentTarget;
}

/** Props are the row (stable while the rows are), booleans, and stable functions, so `memo` skips most rows. */
interface LineProps {
    readonly row: CodeLine;
    /** The highlighted text, made once for each row set. */
    readonly code: () => ReactNode;
    readonly range: boolean;
    readonly ranged: boolean;
    readonly focus: boolean;
    readonly onStart: (row: CodeLine) => void;
    readonly onEnter: (row: CodeLine) => void;
}

const Line = memo(function Line({ row, code, range, ranged, focus, onStart, onEnter }: LineProps): ReactNode {
    const ref = useRef<HTMLTableRowElement>(null);
    useEffect(() => {
        if (focus) ref.current?.scrollIntoView({ block: "center" });
    }, [focus]);
    const [first = "", second] = row.numbers;
    const name = classes(["code-line", ...row.classes, range && "in-range", ranged && "comment-range"]);
    return (
        <tr
            ref={ref}
            className={name}
            onMouseEnter={() => {
                onEnter(row);
            }}
        >
            <td className="ln">
                <button
                    type="button"
                    className="cbtn"
                    title="Comment"
                    onMouseDown={e => {
                        e.preventDefault();
                        onStart(row);
                    }}
                >
                    +
                </button>
                {first}
            </td>
            {second === undefined ? null : <td className="ln ln2">{second}</td>}
            <td>
                {row.sign === null ? null : <span className="sign">{row.sign}</span>}
                {code()}
            </td>
        </tr>
    );
});

function ThreadRow(props: {
    readonly row: CodeLine;
    readonly comments: readonly Comment[];
    readonly draft: Draft | null;
    readonly onDone: () => void;
}): ReactNode {
    const { row, comments, draft, onDone } = props;
    const composing = draft !== null && draft.after === row.key;
    if (comments.length === 0 && !composing) return null;
    return (
        <tr className="code-thread">
            <td colSpan={row.numbers.length + 1}>
                <Thread comments={comments} />
                {composing ? <Composer target={draft.target} onDone={onDone} /> : null}
            </td>
        </tr>
    );
}

interface DragState {
    readonly drag: Drag | null;
    readonly draft: Draft | null;
    readonly clearDraft: () => void;
    readonly onStart: (row: CodeLine) => void;
    readonly onEnter: (row: CodeLine) => void;
}

function useDrag(rows: readonly ViewRow[]): DragState {
    const [drag, setDrag] = useState<Drag | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    useEffect(() => {
        const up = (): void => {
            if (drag === null) return;
            const range = rangeRows(rows, drag.from, drag.to);
            const target = rangeTarget(range);
            const after = range.at(-1)?.key;
            setDrag(null);
            if (target !== null && after !== undefined) setDraft({ keys: range.map(r => r.key), after, target });
        };
        document.addEventListener("mouseup", up);
        return () => {
            document.removeEventListener("mouseup", up);
        };
    }, [drag, rows]);
    const clearDraft = useCallback(() => {
        setDraft(null);
    }, []);
    const onStart = useCallback((row: CodeLine) => {
        setDraft(null);
        setDrag({ from: row, to: row });
    }, []);
    // A row on the other side does not move the end, so the range stays on the side where it started.
    const onEnter = useCallback((row: CodeLine) => {
        setDrag(d => {
            if (d === null) return d;
            const to = dragTo(d.from, d.to, row);
            return to === d.to ? d : { from: d.from, to };
        });
    }, []);
    return { drag, draft, clearDraft, onStart, onEnter };
}

function blank(): ReactNode {
    return " ";
}

/** Row key → its highlighted text. highlight.js runs once for each row set, not on each render. */
function useHighlights(rows: readonly ViewRow[]): ReadonlyMap<string, () => ReactNode> {
    return useMemo(
        () =>
            new Map(
                rows.flatMap(r => {
                    if (r.kind !== "code") return [];
                    const node = highlightLine(r.path, r.text);
                    return [[r.key, (): ReactNode => node] as const];
                }),
            ),
        [rows],
    );
}

function HunkRow({ text }: { readonly text: string }): ReactNode {
    return (
        <tr className="diff-hunk-row">
            <td className="ln" />
            <td className="ln ln2" />
            <td>{text}</td>
        </tr>
    );
}

export function CodeTable({ rows, diff }: { readonly rows: readonly ViewRow[]; readonly diff: boolean }): ReactNode {
    const { comments } = useApp();
    const { drag, draft, clearDraft, onStart, onEnter } = useDrag(rows);
    const highlights = useHighlights(rows);
    const threads = useMemo(() => codeThreads(rows, comments), [rows, comments]);
    const dragged = new Set(drag === null ? [] : rangeRows(rows, drag.from, drag.to).map(r => r.key));
    const focus = useMemo(() => focusKey(rows), [rows]);
    const body = rows.map(row => {
        if (row.kind === "hunk") return <HunkRow key={row.key} text={row.text} />;
        return [
            <Line
                key={row.key}
                row={row}
                code={highlights.get(row.key) ?? blank}
                range={dragged.has(row.key) || (draft?.keys.includes(row.key) ?? false)}
                ranged={threads.ranged.has(row.key)}
                focus={row.key === focus}
                onStart={onStart}
                onEnter={onEnter}
            />,
            <ThreadRow
                key={`${row.key}:thread`}
                row={row}
                comments={threads.byRow.get(row.key) ?? []}
                draft={draft}
                onDone={clearDraft}
            />,
        ];
    });
    return (
        <table className={diff ? "code-table diff-table" : "code-table"}>
            <tbody>{body}</tbody>
        </table>
    );
}
