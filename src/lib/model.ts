// The typed Digest model: what the linter, fmt, and the UI read. Pure: no Node or Bun APIs.
import { blockId } from "./digest";
import { parseBlocks, type Block, type Inline } from "./md";

/** ① is 1 and ⑳ is 20. */
const CIRCLED_ONE = 0x24_60;
const CIRCLED_MAX = 20;

export function circled(n: number): string {
    return String.fromCodePoint(CIRCLED_ONE + n - 1);
}

/** The circled number at the start of the text (after spaces and quotes), or null. */
export function leadingNumber(text: string): number | null {
    const first = text.trimStart().replace(/^["']/u, "").codePointAt(0);
    if (first === undefined) return null;
    const n = first - CIRCLED_ONE + 1;
    return n >= 1 && n <= CIRCLED_MAX ? n : null;
}

export interface DiagramNode {
    readonly id: string;
    readonly label: string;
    readonly number: number | null;
    readonly changed: boolean;
    readonly line: number;
}

export interface Diagram {
    readonly line: number;
    readonly source: string;
    /** Each node once, in the order of its first appearance. */
    readonly nodes: readonly DiagramNode[];
    readonly hasChangedClassDef: boolean;
}

export interface NumberedItem {
    readonly number: number | null;
    readonly line: number;
    readonly text: string;
}

export interface Section {
    readonly title: string;
    readonly line: number;
    readonly blocks: readonly Block[];
}

export interface ModelBlock {
    readonly cid: string;
    /** The h2 or h3 title that the block is under, or "" before the first heading. */
    readonly section: string;
    readonly text: string;
    readonly line: number;
}

export interface DigestModel {
    readonly title: { readonly text: string; readonly line: number } | null;
    readonly preamble: readonly Block[];
    readonly sections: readonly Section[];
    readonly diagram: Diagram | null;
    readonly notes: readonly NumberedItem[];
    readonly changes: readonly NumberedItem[];
    readonly blocks: readonly ModelBlock[];
    /** Every block, in order, for rules that check all text. */
    readonly all: readonly Block[];
}

const KEYWORD = /^(?:flowchart|graph|subgraph|end|classDef|style|linkStyle|click|direction|%%)\b/u;
const NODE =
    /([A-Za-z_][\w-]*)\s*(\[\[|\[\(|\(\(|\(\[|\[\/|\[\\|\[|\(|\{\{|\{|>)\s*(.*?)\s*(\]\]|\)\]|\)\)|\]\)|\/\]|\\\]|\]|\)|\}\}|\})(?::::([\w-]+))?/gu;
const BARE = /^([A-Za-z_][\w-]*)(?::::([\w-]+))?/u;
const ARROW = /\s*(?:<?[-=.]{2,}>?|--[^-|]+-->|-\.[^.]*\.->)\s*(?:\|[^|]*\|\s*)?/u;
const CLASS_LINE = /^class\s+([\w,\s-]+?)\s+([\w-]+)\s*;?$/u;

interface NodeDraft {
    readonly id: string;
    readonly label: string;
    readonly changed: boolean;
    readonly line: number;
}

function unquote(label: string): string {
    return label.replace(/^"(.*)"$/u, "$1");
}

/** The nodes that one statement defines or names. */
function readStatement(statement: string, line: number): NodeDraft[] {
    const classLine = CLASS_LINE.exec(statement);
    if (classLine !== null) {
        const [, ids = "", cls] = classLine;
        if (cls !== "changed") return [];
        return ids.split(",").map(id => ({ id: id.trim(), label: "", changed: true, line }));
    }
    const out: NodeDraft[] = [];
    for (const segment of statement.split(ARROW)) {
        const defined = [...segment.matchAll(NODE)];
        for (const m of defined) {
            const [, id = "", , label = "", , cls] = m;
            out.push({ id, label: unquote(label), changed: cls === "changed", line });
        }
        const bare = defined.length === 0 ? BARE.exec(segment.trim()) : null;
        if (bare !== null) {
            const [, id = "", cls] = bare;
            out.push({ id, label: "", changed: cls === "changed", line });
        }
    }
    return out;
}

export function parseDiagram(source: string, line: number): Diagram {
    const nodes = new Map<string, NodeDraft>();
    const add = (draft: NodeDraft): void => {
        const old = nodes.get(draft.id);
        nodes.set(
            draft.id,
            old === undefined
                ? draft
                : { ...old, label: old.label === "" ? draft.label : old.label, changed: old.changed || draft.changed },
        );
    };
    let hasChangedClassDef = false;
    for (const [i, text] of source.split("\n").entries()) {
        const statement = text.trim();
        if (/^classDef\s+changed\b/u.test(statement)) hasChangedClassDef = true;
        if (statement === "" || KEYWORD.test(statement)) continue;
        // The first line of the code block is the fence, so the source starts one line later.
        for (const part of statement.split(";"))
            for (const draft of readStatement(part.trim(), line + 1 + i)) add(draft);
    }
    const list: DiagramNode[] = [];
    for (const n of nodes.values()) list.push({ ...n, number: leadingNumber(n.label) });
    return { line, source, nodes: list, hasChangedClassDef };
}

function textOf(inline: readonly Inline[]): string {
    return inline.map(i => (i.kind === "code" ? `\`${i.text}\`` : i.text)).join("");
}

function normalize(text: string): string {
    return text.replaceAll(/\s+/gu, " ").trim();
}

function shift(block: Block, offset: number): Block {
    if (block.kind !== "list") return { ...block, line: block.line + offset };
    return { ...block, line: block.line + offset, items: block.items.map(i => ({ ...i, line: i.line + offset })) };
}

function modelBlocks(all: readonly Block[]): ModelBlock[] {
    const out: ModelBlock[] = [];
    let section = "";
    const add = (text: string, line: number): void => {
        const t = normalize(text);
        out.push({ cid: blockId(section, t), section, text: t, line });
    };
    for (const block of all) {
        switch (block.kind) {
            case "heading": {
                if (block.depth === 2 || block.depth === 3) section = normalize(block.text);
                add(textOf(block.inline), block.line);
                break;
            }
            case "paragraph":
            case "blockquote": {
                add(textOf(block.inline), block.line);
                break;
            }
            case "list": {
                for (const item of block.items) add(textOf(item.inline), item.line);
                break;
            }
            case "table": {
                for (const [i, row] of block.rows.entries())
                    add(row.map(c => textOf(c.inline)).join(" | "), block.line + 2 + i);
                break;
            }
            case "code": {
                add(block.text, block.line);
                break;
            }
            case "html":
            case "def":
            case "other": {
                break;
            }
        }
    }
    return out;
}

function numbered(items: readonly { readonly line: number; readonly text: string }[]): NumberedItem[] {
    return items.map(i => ({ number: leadingNumber(i.text), line: i.line, text: i.text }));
}

function listItemsIn(blocks: readonly Block[]): { line: number; text: string }[] {
    const out: { line: number; text: string }[] = [];
    for (const b of blocks)
        if (b.kind === "list") for (const item of b.items) out.push({ line: item.line, text: item.text });
    return out;
}

/**
 * Builds the model from a digest body. `lineOffset` is the number of lines before the body
 * (the frontmatter), so that every line number is a line in the file.
 */
export function buildModel(body: string, lineOffset = 0): DigestModel {
    const all = parseBlocks(body).map(b => shift(b, lineOffset));
    const firstH2 = all.findIndex(b => b.kind === "heading" && b.depth === 2);
    const preamble = firstH2 === -1 ? all : all.slice(0, firstH2);
    const sections: Section[] = [];
    for (const [i, block] of all.entries()) {
        if (block.kind !== "heading" || block.depth !== 2) continue;
        const next = all.findIndex((b, j) => j > i && b.kind === "heading" && b.depth === 2);
        sections.push({
            title: normalize(block.text),
            line: block.line,
            blocks: all.slice(i + 1, next === -1 ? undefined : next),
        });
    }
    const h1 = all.find(b => b.kind === "heading" && b.depth === 1);
    const architecture = sections.find(s => s.title.toLowerCase() === "architecture");
    const diagramIndex = architecture?.blocks.findIndex(b => b.kind === "code" && b.lang === "mermaid") ?? -1;
    const diagramBlock = architecture?.blocks[diagramIndex];
    const diagram = diagramBlock?.kind === "code" ? parseDiagram(diagramBlock.text, diagramBlock.line) : null;
    const notesBlock = architecture?.blocks.slice(diagramIndex + 1).find(b => b.kind === "list");
    const changes = sections.find(s => s.title.toLowerCase() === "changes");
    return {
        title: h1?.kind === "heading" ? { text: normalize(h1.text), line: h1.line } : null,
        preamble,
        sections,
        diagram,
        notes: diagram === null || notesBlock?.kind !== "list" ? [] : numbered(notesBlock.items),
        changes: numbered(listItemsIn(changes?.blocks ?? [])),
        blocks: modelBlocks(all),
        all,
    };
}
