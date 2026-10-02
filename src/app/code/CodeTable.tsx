// The code rows with line and range comments: press + on a line and drag to another line on the same side.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Comment, CommentTarget } from "../../lib/schemas";
import { Composer, Thread } from "../components/Thread";
import { highlightLine } from "../highlight";
import { useApp } from "../state/context";
import type { CodeLine, ViewRow } from "./rows";
import { codeThreads, rangeRows, rangeTarget } from "./select";

interface Drag {
    readonly from: CodeLine;
    readonly to: CodeLine;
}

interface Draft {
    readonly keys: readonly string[];
    readonly after: string;
    readonly target: CommentTarget;
}

function classes(parts: readonly (string | false)[]): string {
    return parts.filter(p => p !== false).join(" ");
}

const FOCUS = ["hunk-focus", "focus", "added", "changed", "removed"];

function focusKey(rows: readonly ViewRow[]): string | undefined {
    const code = rows.filter(r => r.kind === "code");
    return FOCUS.map(c => code.find(r => r.classes.includes(c))?.key).find(k => k !== undefined);
}

interface LineProps {
    readonly row: CodeLine;
    readonly marked: { readonly range: boolean; readonly ranged: boolean; readonly focus: boolean };
    readonly onStart: () => void;
    readonly onEnter: () => void;
}

function Line({ row, marked, onStart, onEnter }: LineProps): ReactNode {
    const ref = useRef<HTMLTableRowElement>(null);
    useEffect(() => {
        if (marked.focus) ref.current?.scrollIntoView({ block: "center" });
    }, [marked.focus]);
    const [first = "", second] = row.numbers;
    const name = classes(["code-line", ...row.classes, marked.range && "in-range", marked.ranged && "comment-range"]);
    return (
        <tr ref={ref} className={name} onMouseEnter={onEnter}>
            <td className="ln">
                <button
                    type="button"
                    className="cbtn"
                    title="Comment"
                    onMouseDown={e => {
                        e.preventDefault();
                        onStart();
                    }}
                >
                    +
                </button>
                {first}
            </td>
            {second === undefined ? null : <td className="ln ln2">{second}</td>}
            <td>
                {row.sign === null ? null : <span className="sign">{row.sign}</span>}
                {highlightLine(row.path, row.text)}
            </td>
        </tr>
    );
}

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

function useDrag(rows: readonly ViewRow[]): {
    readonly drag: Drag | null;
    readonly setDrag: (d: Drag | null) => void;
    readonly draft: Draft | null;
    readonly setDraft: (d: Draft | null) => void;
} {
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
    return { drag, setDrag, draft, setDraft };
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
    const { drag, setDrag, draft, setDraft } = useDrag(rows);
    const threads = codeThreads(rows, comments);
    const dragged = new Set(drag === null ? [] : rangeRows(rows, drag.from, drag.to).map(r => r.key));
    const focus = focusKey(rows);
    const body = rows.map(row => {
        if (row.kind === "hunk") return <HunkRow key={row.key} text={row.text} />;
        const range = dragged.has(row.key) || (draft?.keys.includes(row.key) ?? false);
        return [
            <Line
                key={row.key}
                row={row}
                marked={{ range, ranged: threads.ranged.has(row.key), focus: row.key === focus }}
                onStart={() => {
                    setDraft(null);
                    setDrag({ from: row, to: row });
                }}
                onEnter={() => {
                    if (drag !== null) setDrag({ from: drag.from, to: row });
                }}
            />,
            <ThreadRow
                key={`${row.key}:thread`}
                row={row}
                comments={threads.byRow.get(row.key) ?? []}
                draft={draft}
                onDone={() => {
                    setDraft(null);
                }}
            />,
        ];
    });
    return (
        <table className={diff ? "code-table diff-table" : "code-table"}>
            <tbody>{body}</tbody>
        </table>
    );
}
