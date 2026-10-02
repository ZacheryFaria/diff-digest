// Digest blocks as React elements. Each commentable block gets its block id (cid) by its file line.
import { createElement, type ReactNode } from "react";
import type { Block, ListItem } from "../../lib/md";
import type { ModelBlock } from "../../lib/model";
import type { Comment, CommentTarget } from "../../lib/schemas";
import { Commentable, CommentableRow } from "../components/Commentable";
import { Inline } from "./Inline";
import { richInline } from "./rich-inline";
import { Mermaid } from "./Mermaid";

export interface BlockContext {
    /** Body line + offset = file line. */
    readonly offset: number;
    readonly blockAt: (fileLine: number) => ModelBlock | undefined;
    readonly commentsFor: (block: ModelBlock) => readonly Comment[];
}

function targetOf(block: ModelBlock): CommentTarget {
    const text = block.text.slice(0, 300);
    return { kind: "digest", cid: block.cid, section: block.section, text, line: block.line };
}

function OnLine({
    line,
    ctx,
    render,
}: {
    readonly line: number;
    readonly ctx: BlockContext;
    readonly render: () => ReactNode;
}): ReactNode {
    const block = ctx.blockAt(line + ctx.offset);
    if (block === undefined) return render();
    return <Commentable target={targetOf(block)} comments={ctx.commentsFor(block)} content={render} />;
}

function Item({ item, ctx }: { readonly item: ListItem; readonly ctx: BlockContext }): ReactNode {
    return (
        <li>
            <OnLine
                line={item.line}
                ctx={ctx}
                render={() => (
                    <>
                        {item.checked === null ? null : (
                            <input type="checkbox" checked={item.checked} readOnly disabled />
                        )}
                        <Inline nodes={richInline(item.ownText)} />
                    </>
                )}
            />
            {item.children.map(child => (
                <BlockView key={child.line} block={child} ctx={ctx} />
            ))}
        </li>
    );
}

function cellNodes(texts: readonly { readonly text: string }[]): readonly ReactNode[] {
    return texts.map(c => createElement(Inline, { nodes: richInline(c.text) }));
}

type TableBlock = Extract<Block, { kind: "table" }>;

function Table({ block, ctx }: { readonly block: TableBlock; readonly ctx: BlockContext }): ReactNode {
    // A table row's file line: the header and the delimiter come first.
    const rows = block.rows.map((row, i) => ({ row, line: block.line + 2 + i }));
    const head = cellNodes(block.header).map(cell => createElement("th", null, cell));
    return (
        <table>
            <thead>{createElement("tr", null, ...head)}</thead>
            <tbody>
                {rows.map(r => {
                    const found = ctx.blockAt(r.line + ctx.offset);
                    return (
                        <CommentableRow
                            key={r.line}
                            target={found === undefined ? null : targetOf(found)}
                            comments={found === undefined ? [] : ctx.commentsFor(found)}
                            cells={() => cellNodes(r.row)}
                            width={block.header.length}
                        />
                    );
                })}
            </tbody>
        </table>
    );
}

function TextBlock({
    block,
    ctx,
}: {
    readonly block: Extract<Block, { kind: "heading" | "paragraph" }>;
    readonly ctx: BlockContext;
}): ReactNode {
    const tag = block.kind === "heading" ? `h${Math.min(block.depth, 6)}` : "p";
    return (
        <OnLine
            line={block.line}
            ctx={ctx}
            render={() => createElement(tag, null, createElement(Inline, { nodes: richInline(block.text) }))}
        />
    );
}

function CodeBlock({
    block,
    ctx,
}: {
    readonly block: Extract<Block, { kind: "code" }>;
    readonly ctx: BlockContext;
}): ReactNode {
    const render = (): ReactNode =>
        block.lang === "mermaid" ? (
            <Mermaid source={block.text} />
        ) : (
            <pre>
                <code>{block.text}</code>
            </pre>
        );
    return <OnLine line={block.line} ctx={ctx} render={render} />;
}

export function BlockView({ block, ctx }: { readonly block: Block; readonly ctx: BlockContext }): ReactNode {
    if (block.kind === "heading" || block.kind === "paragraph") return <TextBlock block={block} ctx={ctx} />;
    if (block.kind === "list") {
        const items = block.items.map(item => <Item key={item.line} item={item} ctx={ctx} />);
        return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    if (block.kind === "table") return <Table block={block} ctx={ctx} />;
    if (block.kind === "code") return <CodeBlock block={block} ctx={ctx} />;
    if (block.kind === "blockquote")
        return (
            <blockquote>
                {block.children.map(child => (
                    <BlockView key={child.line} block={child} ctx={ctx} />
                ))}
            </blockquote>
        );
    if (block.kind === "html") return <pre className="raw-html">{block.text}</pre>;
    return block.kind === "other" && block.type === "hr" ? <hr /> : null;
}
