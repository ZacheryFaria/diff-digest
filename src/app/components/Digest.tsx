// The digest body, with comments on its blocks, and the comments whose block is gone.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { parseBlocks } from "../../lib/md";
import { buildModel } from "../../lib/model";
import type { Comment } from "../../lib/schemas";
import { assignDigestComments, blockIndex } from "../comments-map";
import { BlockView, type BlockContext } from "../markdown/Blocks";
import { linkDefs, richInline } from "../markdown/rich-inline";
import { useApp } from "../state/context";
import { useDiagramFocus } from "../state/diagram-focus";
import { Thread } from "./Thread";

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
    const links = useMemo(() => linkDefs(body), [body]);
    const assigned = useMemo(() => assignDigestComments(model.blocks, comments), [model, comments]);
    const { diagram, marked, focus } = useDiagramFocus(model);
    const article = useRef<HTMLElement>(null);
    const ctx = useMemo(
        (): BlockContext => ({
            offset: lineOffset,
            blockAt: blockIndex(model.blocks),
            commentsFor: block => assigned.byBlock.get(block.line) ?? [],
            inline: text => richInline(text, links),
            diagram,
            marked,
        }),
        [model, assigned, lineOffset, links, diagram, marked],
    );
    useEffect(() => {
        if (focus !== null)
            article.current
                ?.querySelector(".node-focus-first")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, [focus]);
    const { others } = assigned;
    useEffect(() => {
        document.title = model.title?.text ?? "Diff digest";
    }, [model]);
    return (
        <article id="content" ref={article}>
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
