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
    /** The item text, without the bullet or the number. */
    readonly text: string;
    readonly inline: readonly Inline[];
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
        | { readonly kind: "blockquote"; readonly text: string; readonly inline: readonly Inline[] }
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
const TextBlockTokenSchema = z.looseObject({ type: z.enum(["paragraph", "blockquote", "text"]), text: z.string() });
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

function listItems(source: string, offset: number, token: z.infer<typeof ListTokenSchema>): ListItem[] {
    const items: ListItem[] = [];
    let cursor = offset;
    for (const item of token.items) {
        const at = source.indexOf(item.raw, cursor);
        const start = at === -1 ? cursor : at;
        items.push({ line: lineAt(source, start), raw: item.raw, text: item.text, inline: inlineOf(children(item)) });
        cursor = start + item.raw.length;
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
    if (textBlock.success) {
        const kind = textBlock.data.type === "blockquote" ? "blockquote" : "paragraph";
        const inline = inlineOf(children(token));
        return { ...head, kind, text: textBlock.data.text, inline };
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

/** Parses Markdown (CommonMark + GFM) into typed blocks with 1-based line numbers. */
export function parseBlocks(source: string): Block[] {
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
