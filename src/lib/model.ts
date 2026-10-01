// The typed Digest model: what the linter, fmt, and the UI read. Pure: no Node or Bun APIs.
import { blockId, leadingNumber } from "./digest";
import { endLine, parseBlocks, type Block, type Inline, type ListItem } from "./md";

export { circled, leadingNumber } from "./digest";

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
    /** The last line of the item (with its continuation lines and nested blocks). */
    readonly endLine: number;
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

const KEYWORD =
    /^(?:(?:flowchart|graph|subgraph|end|classDef|style|linkStyle|click|direction|accTitle|accDescr)\b|%%)/u;
const HEADER = /^(?:flowchart|graph)\b/u;
const NODE =
    /([A-Za-z_][\w-]*)\s*(\[\[|\[\(|\(\(|\(\[|\[\/|\[\\|\[|\(|\{\{|\{|>)\s*(.*?)\s*(\]\]|\)\]|\)\)|\]\)|\/\]|\\\]|\]|\)|\}\}|\})(?::::([\w-]+))?/gu;
const BARE = /^([A-Za-z_][\w-]*)(?::::([\w-]+))?/u;
// Edges with a text label (`-- text -->`, `== text ==>`, `-. text .->`) come first, so the label is not read as a
// node. The label may contain dashes, but its first character is not the edge character, so `a --- b --> c` is two edges.
// An edge can end with `>`, `o`, or `x` (`--o`, `x--x`); an `o` or `x` end has a space on its outer side. `~~~` is an edge.
const ARROW =
    /\s*(?:--(?![ox](?:\s|$))[^-|>][^|>]*?--[>ox]|==[^=|>][^|>]*?==[>ox]|-\.[^.|>][^|>]*?\.-[>ox]|(?:(?<=^|\s)[ox]|<)?[-=.]{2,}(?:[>ox](?=\s|$)|>)?|~{3,})\s*(?:\|[^|]*\|\s*)?/u;
const CLASS_LINE = /^class\s+([\w,\s-]+?)\s+([\w-]+)\s*;?$/u;
const QUOTED = /"[^"]*"/gu;
const MASKED = /"(\d+)"/gu;

interface NodeDraft {
    readonly id: string;
    readonly label: string;
    readonly changed: boolean;
    readonly line: number;
}

/** Puts the quoted text back in a masked label, and removes the outer quotes. */
function unmask(label: string, quotes: readonly string[]): string {
    const text = label.replaceAll(MASKED, (match: string, n: string) => `"${quotes[Number(n)] ?? match}"`);
    return text.replace(/^"(.*)"$/u, "$1");
}

/** Splits the text at each `separator` that is not in brackets. Quoted text is masked before. */
function splitTop(text: string, separator: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < text.length; i += 1) {
        const c = text.charAt(i);
        if ("[({".includes(c)) depth += 1;
        else if ("])}".includes(c)) depth = Math.max(0, depth - 1);
        else if (c === separator && depth === 0) {
            out.push(text.slice(from, i));
            from = i + 1;
        }
    }
    out.push(text.slice(from));
    return out;
}

/** The nodes that one statement defines or names. Quoted text in `statement` is masked as `"n"`. */
function readStatement(statement: string, line: number, quotes: readonly string[]): NodeDraft[] {
    const classLine = CLASS_LINE.exec(statement);
    if (classLine !== null) {
        const [, ids = "", cls] = classLine;
        if (cls !== "changed") return [];
        return ids.split(",").map(id => ({ id: id.trim(), label: "", changed: true, line }));
    }
    const out: NodeDraft[] = [];
    for (const segment of statement.split(ARROW).flatMap(s => splitTop(s, "&"))) {
        const defined = [...segment.matchAll(NODE)];
        for (const m of defined) {
            const [, id = "", , label = "", , cls] = m;
            out.push({ id, label: unmask(label, quotes), changed: cls === "changed", line });
        }
        const bare = defined.length === 0 ? BARE.exec(segment.trim()) : null;
        if (bare !== null) {
            const [, id = "", cls] = bare;
            out.push({ id, label: "", changed: cls === "changed", line });
        }
    }
    return out;
}

/** The nodes of one source line. A `;` or a `]` in quoted text does not end a statement or a label. */
function readLine(text: string, line: number): NodeDraft[] {
    const quotes: string[] = [];
    const masked = text.replaceAll(QUOTED, q => `"${quotes.push(q.slice(1, -1)) - 1}"`);
    return splitTop(masked, ";").flatMap(part => readStatement(part.trim(), line, quotes));
}

/** The index of the first line after the `flowchart` or `graph` line, or -1 for other diagram types. */
function bodyStart(lines: readonly string[]): number {
    let i = 0;
    const skip = (): void => {
        while (i < lines.length && ((lines[i] ?? "").trim() === "" || (lines[i] ?? "").trim().startsWith("%%"))) i += 1;
    };
    skip();
    if ((lines[i] ?? "").trim() === "---") {
        const close = lines.findIndex((l, j) => j > i && l.trim() === "---");
        i = close === -1 ? lines.length : close + 1;
        skip();
    }
    return HEADER.test((lines[i] ?? "").trim()) ? i + 1 : -1;
}

function merge(old: NodeDraft | undefined, draft: NodeDraft): NodeDraft {
    if (old === undefined) return draft;
    return { ...old, label: old.label === "" ? draft.label : old.label, changed: old.changed || draft.changed };
}

/** Reads the nodes of a `flowchart` or `graph` diagram. Other diagram types have no nodes. */
export function parseDiagram(source: string, line: number): Diagram {
    const lines = source.split("\n");
    const start = bodyStart(lines);
    if (start === -1) return { line, source, nodes: [], hasChangedClassDef: false };
    const nodes = new Map<string, NodeDraft>();
    let hasChangedClassDef = false;
    let inAccDescr = false;
    for (const [i, text] of lines.entries()) {
        const statement = text.trim();
        if (i < start || inAccDescr) {
            inAccDescr = inAccDescr && !statement.includes("}");
            continue;
        }
        if (/^classDef\s+changed\b/u.test(statement)) hasChangedClassDef = true;
        if (/^accDescr\s*\{/u.test(statement)) inAccDescr = !statement.includes("}");
        if (statement === "" || KEYWORD.test(statement)) continue;
        // The first line of the code block is the fence, so the source starts one line later.
        for (const draft of readLine(statement, line + 1 + i)) nodes.set(draft.id, merge(nodes.get(draft.id), draft));
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
    const line = block.line + offset;
    if (block.kind === "blockquote") return { ...block, line, children: block.children.map(b => shift(b, offset)) };
    if (block.kind !== "list") return { ...block, line };
    const items = block.items.map(i => ({
        ...i,
        line: i.line + offset,
        children: i.children.map(b => shift(b, offset)),
    }));
    return { ...block, line, items };
}

/**
 * The model blocks of `blocks` and of their nested blocks, from the section `start`. Only a top-level
 * heading starts a section, so nested blocks keep the section of their parent.
 */
function blocksIn(blocks: readonly Block[], start: string, top: boolean): ModelBlock[] {
    const out: ModelBlock[] = [];
    let section = start;
    const add = (text: string, line: number): void => {
        const t = normalize(text);
        out.push({ cid: blockId(section, t), section, text: t, line });
    };
    for (const block of blocks) {
        switch (block.kind) {
            case "heading": {
                if (top && (block.depth === 2 || block.depth === 3)) section = normalize(block.text);
                add(textOf(block.inline), block.line);
                break;
            }
            case "paragraph": {
                add(textOf(block.inline), block.line);
                break;
            }
            case "blockquote": {
                out.push(...blocksIn(block.children, section, false));
                break;
            }
            case "list": {
                for (const item of block.items) {
                    add(textOf(item.inline), item.line);
                    out.push(...blocksIn(item.children, section, false));
                }
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

function numbered(items: readonly ListItem[]): NumberedItem[] {
    return items.map(i => ({ number: leadingNumber(i.text), line: i.line, endLine: endLine(i), text: i.text }));
}

function listItemsIn(blocks: readonly Block[]): ListItem[] {
    return blocks.flatMap(b => (b.kind === "list" ? b.items : []));
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
        blocks: blocksIn(all, "", true),
        all,
    };
}
