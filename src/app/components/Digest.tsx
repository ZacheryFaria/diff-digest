// The digest body, with comments on its blocks, and the comments whose block is gone.
import { useMemo, type ReactNode } from "react";
import { parseBlocks } from "../../lib/md";
import { buildModel, type ModelBlock } from "../../lib/model";
import type { Comment } from "../../lib/schemas";
import { BlockView, type BlockContext } from "../markdown/Blocks";
import { useApp } from "../state/context";
import { Thread } from "./Thread";

/** A digest comment belongs to the block with its cid, and with its line when it has one (equal cids). */
function belongsTo(comment: Comment, block: ModelBlock): boolean {
    const t = comment.target;
    return t.kind === "digest" && t.cid === block.cid && (t.line === undefined || t.line === block.line);
}

/** A comment whose block is gone: a code comment links to its lines; a digest comment shows its old text. */
function OtherComment({ comment }: { readonly comment: Comment }): ReactNode {
    const { openCode } = useApp();
    const t = comment.target;
    const where =
        t.kind === "code" ? (
            <button
                type="button"
                className="anchor"
                onClick={() => {
                    openCode({ path: t.path, start: t.line, end: t.endLine ?? t.line, rev: t.rev });
                }}
            >
                <code>
                    {t.path}:{t.line}
                    {t.endLine === undefined || t.endLine === t.line ? "" : `-${t.endLine}`}
                </code>
            </button>
        ) : (
            <em>{t.text.slice(0, 120)}</em>
        );
    return (
        <div className="orphan">
            <div className="who">
                On {where} ({t.kind === "code" ? (t.rev === "head" ? "after" : "before") : "text changed"})
            </div>
            <Thread comments={[comment]} />
        </div>
    );
}

export interface DigestViewProps {
    readonly body: string;
    readonly lineOffset: number;
    readonly comments: readonly Comment[];
}

export function DigestView({ body, lineOffset, comments }: DigestViewProps): ReactNode {
    const blocks = useMemo(() => parseBlocks(body), [body]);
    const model = useMemo(() => buildModel(body, lineOffset), [body, lineOffset]);
    const ctx = useMemo((): BlockContext => {
        const byLine = new Map(model.blocks.map(b => [b.line, b]));
        return {
            offset: lineOffset,
            blockAt: line => byLine.get(line),
            commentsFor: block => comments.filter(c => belongsTo(c, block)),
        };
    }, [model, comments, lineOffset]);
    const others = comments.filter(c => !model.blocks.some(b => belongsTo(c, b)));
    return (
        <article id="content">
            {blocks.map(b => (
                <BlockView key={b.line} block={b} ctx={ctx} />
            ))}
            {others.length > 0 ? (
                <section id="orphans">
                    <h2>Other comments</h2>
                    {others.map(c => (
                        <OtherComment key={c.id} comment={c} />
                    ))}
                </section>
            ) : null}
        </article>
    );
}
