// The only file that reads marked tokens. marked's `Token` type includes `Tokens.Generic`, which
// has an `any` index signature, so every token is parsed with zod into the typed blocks below.
// Pure: the UI imports this file, so it must not import Node or Bun APIs.
import { marked } from "marked";
import { z } from "zod";

export type Inline =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "code"; readonly text: string }
    | { readonly kind: "link"; readonly text: string; readonly href: string; readonly raw: string }
    | { readonly kind: "html"; readonly text: string };

export interface ListItem {
    readonly line: number;
    readonly raw: string;
    /** The item text, without the bullet or the number. It includes the text of nested blocks. */
    readonly text: string;
    /** The inline content of the item's own text only (not of its nested blocks). */
    readonly inline: readonly Inline[];
    /** The nested blocks of the item (lists, code, more paragraphs), with their file lines. */
    readonly children: readonly Block[];
}

export interface Cell {
    readonly text: string;
    readonly inline: readonly Inline[];
}

interface BlockBase {
    /** 1-based line of the first line of the block. */
    readonly line: number;
    readonly raw: string;
}

export type Block = BlockBase &
    (
        | {
              readonly kind: "heading";
              readonly depth: number;
              readonly text: string;
              readonly inline: readonly Inline[];
          }
        | { readonly kind: "paragraph"; readonly text: string; readonly inline: readonly Inline[] }
        | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly ListItem[] }
        | { readonly kind: "table"; readonly header: readonly Cell[]; readonly rows: readonly (readonly Cell[])[] }
        | { readonly kind: "code"; readonly lang: string; readonly text: string }
        | { readonly kind: "blockquote"; readonly text: string; readonly children: readonly Block[] }
        | { readonly kind: "html"; readonly text: string }
        | { readonly kind: "def" }
        | { readonly kind: "other"; readonly type: string }
    );

const RawSchema = z.looseObject({ type: z.string(), raw: z.string() });
const WithTokensSchema = z.looseObject({ tokens: z.array(z.unknown()).optional() });
const TextTokenSchema = z.looseObject({ type: z.enum(["text", "escape", "strong", "em", "del"]), text: z.string() });
const CodespanTokenSchema = z.looseObject({ type: z.literal("codespan"), text: z.string() });
const LinkTokenSchema = z.looseObject({ type: z.literal("link"), text: z.string(), href: z.string(), raw: z.string() });
const HtmlTokenSchema = z.looseObject({ type: z.literal("html"), text: z.string() });
const HeadingTokenSchema = z.looseObject({ type: z.literal("heading"), depth: z.int(), text: z.string() });
const TextBlockTokenSchema = z.looseObject({ type: z.enum(["paragraph", "text"]), text: z.string() });
const BlockquoteTokenSchema = z.looseObject({ type: z.literal("blockquote"), text: z.string() });
const ListItemTokenSchema = z
    .looseObject({ type: z.literal("list_item"), raw: z.string(), text: z.string() })
    .readonly();
const ListTokenSchema = z
    .looseObject({ type: z.literal("list"), ordered: z.boolean(), items: z.array(ListItemTokenSchema).readonly() })
    .readonly();
const CellTokenSchema = z.looseObject({ text: z.string(), tokens: z.array(z.unknown()).readonly() }).readonly();
const TableTokenSchema = z
    .looseObject({
        type: z.literal("table"),
        header: z.array(CellTokenSchema).readonly(),
        rows: z.array(z.array(CellTokenSchema).readonly()).readonly(),
    })
    .readonly();
const CodeTokenSchema = z.looseObject({ type: z.literal("code"), lang: z.string().optional(), text: z.string() });

function children(token: unknown): readonly unknown[] {
    const parsed = WithTokensSchema.safeParse(token);
    return parsed.success ? (parsed.data.tokens ?? []) : [];
}

/** Flattens inline tokens. Text inside strong, em, and del becomes plain text. */
export function inlineOf(tokens: readonly unknown[]): Inline[] {
    const out: Inline[] = [];
    for (const token of tokens) {
        const code = CodespanTokenSchema.safeParse(token);
        if (code.success) {
            out.push({ kind: "code", text: code.data.text });
            continue;
        }
        const link = LinkTokenSchema.safeParse(token);
        if (link.success) {
            out.push({ kind: "link", text: link.data.text, href: link.data.href, raw: link.data.raw });
            continue;
        }
        const html = HtmlTokenSchema.safeParse(token);
        if (html.success) {
            out.push({ kind: "html", text: html.data.text });
            continue;
        }
        const nested = children(token);
        if (nested.length > 0) {
            out.push(...inlineOf(nested));
            continue;
        }
        const text = TextTokenSchema.safeParse(token);
        if (text.success) out.push({ kind: "text", text: text.data.text });
    }
    return out;
}

function lineAt(source: string, offset: number): number {
    return source.slice(0, offset).split("\n").length;
}

/**
 * Finds a nested token in the source. marked removes the indent and the `>` marks from nested raw text,
 * so the search uses the first non-blank line of the raw text. The line count does not change.
 * Returns the offset of the first line and the offset of the end of the last line.
 */
function locate(source: string, cursor: number, raw: string): { readonly start: number; readonly end: number } {
    const rows = raw.replace(/\n+$/u, "").split("\n");
    const firstRow = Math.max(
        0,
        rows.findIndex(r => r.trim() !== ""),
    );
    const first = rows[firstRow]?.trim() ?? "";
    const found = first === "" ? -1 : source.indexOf(first, cursor);
    const start = found === -1 ? cursor : found;
    let end = start;
    for (let i = firstRow; i < rows.length; i += 1) {
        const next = source.indexOf("\n", end + (i === firstRow ? 0 : 1));
        end = next === -1 ? source.length : next;
    }
    return { start, end };
}

/** The blocks of nested tokens (in a list item or a blockquote), each with its line in the source. */
function nestedBlocks(source: string, from: number, tokens: readonly unknown[]): Block[] {
    const out: Block[] = [];
    let cursor = from;
    for (const token of tokens) {
        const raw = RawSchema.safeParse(token);
        if (!raw.success || raw.data.type === "space") continue;
        const { start, end } = locate(source, cursor, raw.data.raw);
        const block = toBlock(source, start, token);
        if (block !== null) out.push(block);
        cursor = end;
    }
    return out;
}

function listItem(source: string, start: number, item: z.infer<typeof ListItemTokenSchema>): ListItem {
    const tokens = children(item);
    const head = RawSchema.safeParse(tokens[0]);
    const own = head.success && (head.data.type === "text" || head.data.type === "paragraph");
    const blocks = nestedBlocks(source, start, tokens);
    return {
        line: lineAt(source, start),
        raw: item.raw,
        text: item.text,
        inline: own ? inlineOf(tokens.slice(0, 1)) : [],
        children: own ? blocks.slice(1) : blocks,
    };
}

function listItems(source: string, offset: number, token: z.infer<typeof ListTokenSchema>): ListItem[] {
    const items: ListItem[] = [];
    let cursor = offset;
    for (const item of token.items) {
        const { start, end } = locate(source, cursor, item.raw);
        items.push(listItem(source, start, item));
        cursor = end;
    }
    return items;
}

function toCell(cell: z.infer<typeof CellTokenSchema>): Cell {
    return { text: cell.text, inline: inlineOf(cell.tokens) };
}

function toBlock(source: string, offset: number, token: unknown): Block | null {
    const base = RawSchema.safeParse(token);
    if (!base.success || base.data.type === "space") return null;
    const head = { line: lineAt(source, offset), raw: base.data.raw };
    const heading = HeadingTokenSchema.safeParse(token);
    if (heading.success) {
        const { depth, text } = heading.data;
        return { ...head, kind: "heading", depth, text, inline: inlineOf(children(token)) };
    }
    const textBlock = TextBlockTokenSchema.safeParse(token);
    if (textBlock.success)
        return { ...head, kind: "paragraph", text: textBlock.data.text, inline: inlineOf(children(token)) };
    const quote = BlockquoteTokenSchema.safeParse(token);
    if (quote.success) {
        return {
            ...head,
            kind: "blockquote",
            text: quote.data.text,
            children: nestedBlocks(source, offset, children(token)),
        };
    }
    const list = ListTokenSchema.safeParse(token);
    if (list.success) {
        return { ...head, kind: "list", ordered: list.data.ordered, items: listItems(source, offset, list.data) };
    }
    const table = TableTokenSchema.safeParse(token);
    if (table.success) {
        const header = table.data.header.map(c => toCell(c));
        return { ...head, kind: "table", header, rows: table.data.rows.map(r => r.map(c => toCell(c))) };
    }
    const code = CodeTokenSchema.safeParse(token);
    if (code.success) return { ...head, kind: "code", lang: code.data.lang ?? "", text: code.data.text };
    const html = HtmlTokenSchema.safeParse(token);
    if (html.success) return { ...head, kind: "html", text: html.data.text };
    if (base.data.type === "def") return { ...head, kind: "def" };
    return { ...head, kind: "other", type: base.data.type };
}

/** Parses Markdown (CommonMark + GFM) into typed blocks with 1-based line numbers. CRLF counts as one line end. */
export function parseBlocks(input: string): Block[] {
    // marked turns CRLF and CR into LF, so the offsets must use the same text.
    const source = input.replaceAll(/\r\n?/gu, "\n");
    const tokens: readonly unknown[] = marked.lexer(source, { gfm: true });
    const blocks: Block[] = [];
    let offset = 0;
    for (const token of tokens) {
        const block = toBlock(source, offset, token);
        if (block !== null) blocks.push(block);
        const raw = RawSchema.safeParse(token);
        offset += raw.success ? raw.data.raw.length : 0;
    }
    return blocks;
}

/** The last line (1-based) of a block or a list item, from its raw text. */
export function endLine(block: { readonly line: number; readonly raw: string }): number {
    return block.line + block.raw.replace(/\n+$/u, "").split("\n").length - 1;
}

/** The blocks nested directly in a block: the children of a blockquote and of each list item. */
export function nestedOf(block: Block): readonly Block[] {
    if (block.kind === "blockquote") return block.children;
    if (block.kind === "list") return block.items.flatMap(i => i.children);
    return [];
}

/** Every block and every nested block, depth first, in source order. */
export function flatBlocks(blocks: readonly Block[]): Block[] {
    return blocks.flatMap(b => [b, ...flatBlocks(nestedOf(b))]);
}

/** The lines of every code block, also code blocks nested in list items and blockquotes. */
export function codeLines(blocks: readonly Block[]): Set<number> {
    const out = new Set<number>();
    for (const b of flatBlocks(blocks)) if (b.kind === "code") for (let l = b.line; l <= endLine(b); l += 1) out.add(l);
    return out;
}
