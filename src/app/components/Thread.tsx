// Comments on one target, and the box to write a new one.
import { useState, type ReactNode } from "react";
import type { Comment, CommentTarget } from "../../lib/schemas";
import { attempt } from "../state/attempt";
import { useApp } from "../state/context";

function who(c: Comment): string {
    if (c.author === "agent") return "Agent · note";
    return c.status === "open" ? "You" : `You · ${c.status}`;
}

function CommentView({ comment }: { readonly comment: Comment }): ReactNode {
    const { removeComment, toast } = useApp();
    const remove = (): void => {
        attempt(toast, "Could not delete", () => removeComment(comment.id));
    };
    const reply =
        comment.status === "shared" && comment.ref !== undefined ? (
            <a href={comment.ref} target="_blank" rel="noreferrer">
                Posted
            </a>
        ) : (
            comment.reply
        );
    return (
        <div className={`comment ${comment.status}`}>
            <button type="button" className="del" onClick={remove}>
                Delete
            </button>
            <div className="who">{who(comment)}</div>
            <div className="body">{comment.body}</div>
            {reply === undefined ? null : <div className="reply">↳ {reply}</div>}
        </div>
    );
}

export function Thread({ comments }: { readonly comments: readonly Comment[] }): ReactNode {
    if (comments.length === 0) return null;
    return (
        <div className="thread">
            {comments.map(c => (
                <CommentView key={c.id} comment={c} />
            ))}
        </div>
    );
}

export function Composer({
    target,
    onDone,
}: {
    readonly target: CommentTarget;
    readonly onDone: () => void;
}): ReactNode {
    const { addComment, toast } = useApp();
    const [text, setText] = useState("");
    const save = (): void => {
        const body = text.trim();
        if (body === "") {
            onDone();
            return;
        }
        attempt(toast, "Could not save", async () => {
            await addComment(target, body);
            onDone();
        });
    };
    return (
        <div className="composer">
            <textarea
                autoFocus
                value={text}
                placeholder="Comment for Claude…"
                onChange={e => {
                    setText(e.target.value);
                }}
                onKeyDown={e => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
                    if (e.key === "Escape") onDone();
                }}
            />
            <div className="row">
                <button type="button" onClick={onDone}>
                    Cancel
                </button>
                <button type="button" className="primary" onClick={save}>
                    Comment
                </button>
            </div>
        </div>
    );
}
