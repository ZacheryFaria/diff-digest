// A block that takes comments: a "+" button, its thread, and the composer.
import { createElement, useState, type ReactNode } from "react";
import type { Comment, CommentTarget } from "../../lib/schemas";
import { Composer, Thread } from "./Thread";

export interface CommentableProps {
    readonly target: CommentTarget;
    readonly comments: readonly Comment[];
    /** The block itself. A function, because a `ReactNode` prop is not readonly. */
    readonly content: () => ReactNode;
    readonly className?: string;
}

export function Commentable({ target, comments, content, className }: CommentableProps): ReactNode {
    const [open, setOpen] = useState(false);
    return (
        <div
            className={`commentable${comments.length > 0 ? " has-comments" : ""}${className === undefined ? "" : ` ${className}`}`}
        >
            <button
                type="button"
                className="cbtn"
                title="Comment"
                onClick={() => {
                    setOpen(true);
                }}
            >
                +
            </button>
            {content()}
            <Thread comments={comments} />
            {open ? (
                <Composer
                    target={target}
                    onDone={() => {
                        setOpen(false);
                    }}
                />
            ) : null}
        </div>
    );
}

export interface CommentableRowProps {
    readonly target: CommentTarget | null;
    readonly comments: readonly Comment[];
    /** The cells of the row. The first cell gets the "+" button. */
    readonly cells: () => readonly ReactNode[];
    readonly width: number;
}

/** A table row that takes comments. Its thread and composer go in a full-width row below it. */
export function CommentableRow({ target, comments, cells, width }: CommentableRowProps): ReactNode {
    const [open, setOpen] = useState(false);
    const [first, ...rest] = cells();
    const button =
        target === null ? null : (
            <button
                type="button"
                className="cbtn"
                title="Comment"
                onClick={() => {
                    setOpen(true);
                }}
            >
                +
            </button>
        );
    return (
        <>
            {createElement(
                "tr",
                { className: comments.length > 0 ? "commentable has-comments" : "commentable" },
                createElement("td", null, button, first),
                ...rest.map(cell => createElement("td", null, cell)),
            )}
            {comments.length > 0 || (open && target !== null) ? (
                <tr className="thread-row">
                    <td colSpan={width}>
                        <Thread comments={comments} />
                        {open && target !== null ? (
                            <Composer
                                target={target}
                                onDone={() => {
                                    setOpen(false);
                                }}
                            />
                        ) : null}
                    </td>
                </tr>
            ) : null}
        </>
    );
}
