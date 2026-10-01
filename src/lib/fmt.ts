// Safe auto-fixes for a digest body (spec §9). Each fix keeps the meaning and never deletes
// content. Only `questionsToNotes` removes a section, and it returns the text it removed.
import { KNOWN_SECTIONS, QUESTIONS } from "./lint/structure";
import { parseBlocks, type Block } from "./md";
import { buildModel, circled, leadingNumber } from "./model";

export const CHANGED_CLASS_DEF = "  classDef changed stroke:#ffc430,stroke-width:2px";

export interface FmtOptions {
    readonly questionsToNotes: boolean;
}

export interface FmtResult {
    readonly body: string;
    /** The questions that `questionsToNotes` removed, one per list item or paragraph. */
    readonly questions: readonly string[];
}

const SHORT_RANGE = /`([\w@#./-]+\.\w+):(\d+)-\2`/gu;
const CIRCLED_ANY = /[①-⑳]/u;
const CIRCLED_ALL = /[①-⑳]/gu;
const LIST_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+)/u;
const PIPE = /(?<!\\)\|/u;

interface Chunk {
    readonly title: string | null;
    readonly text: string;
}

/** The last line (1-based) of a block, from its raw text. */
function endLine(block: Block): number {
    return block.line + block.raw.replace(/\n+$/u, "").split("\n").length - 1;
}

function chunks(body: string): Chunk[] {
    const lines = body.split("\n");
    const heads = parseBlocks(body).filter(b => b.kind === "heading" && b.depth === 2);
    const out: Chunk[] = [{ title: null, text: lines.slice(0, (heads[0]?.line ?? lines.length + 1) - 1).join("\n") }];
    for (const [i, head] of heads.entries()) {
        const end = (heads[i + 1]?.line ?? lines.length + 1) - 1;
        const title = head.kind === "heading" ? head.text.trim() : "";
        out.push({ title, text: lines.slice(head.line - 1, end).join("\n") });
    }
    return out;
}

function join(parts: readonly string[]): string {
    const kept = parts.map(p => p.replace(/\n+$/u, "")).filter(p => p.trim() !== "");
    return `${kept.join("\n\n")}\n`;
}

function rank(title: string | null): number {
    if (title === null) return -1;
    const known = KNOWN_SECTIONS.findIndex(k => k.toLowerCase() === title.toLowerCase());
    return known === -1 ? KNOWN_SECTIONS.length : known;
}

export function orderSections(body: string): string {
    const all = chunks(body);
    const sorted = all.toSorted((a, b) => rank(a.title) - rank(b.title));
    if (sorted.every((c, i) => c === all[i])) return body;
    return join(sorted.map(c => c.text));
}

export function questionsToNotes(body: string): FmtResult {
    const all = chunks(body);
    const questions: string[] = [];
    for (const c of all) {
        if (c.title === null || !QUESTIONS.test(c.title)) continue;
        for (const b of parseBlocks(c.text)) {
            if (b.kind === "list") for (const item of b.items) questions.push(item.text.trim());
            if (b.kind === "paragraph") questions.push(b.text.trim());
        }
    }
    if (questions.length === 0 && all.every(c => c.title === null || !QUESTIONS.test(c.title)))
        return { body, questions };
    return { body: join(all.filter(c => c.title === null || !QUESTIONS.test(c.title)).map(c => c.text)), questions };
}

function replaceLeadingNumber(line: string, next: (n: number) => number | undefined): string {
    const marker = LIST_MARKER.exec(line)?.[1] ?? "";
    const rest = line.slice(marker.length);
    const old = leadingNumber(rest);
    const to = old === null ? undefined : next(old);
    return to === undefined ? line : `${marker}${rest.replace(CIRCLED_ANY, circled(to))}`;
}

/** Renumbers the changed nodes 1..n in the order of the diagram, in the diagram, the notes, and Changes. */
export function renumber(body: string): string {
    const model = buildModel(body);
    const diagram = model.diagram;
    if (diagram === null) return body;
    const numbers = diagram.nodes.flatMap(n => (n.number === null ? [] : [n.number]));
    if (new Set(numbers).size !== numbers.length) return body;
    if (numbers.every((n, i) => n === i + 1)) return body;
    const map = new Map(numbers.map((n, i) => [n, i + 1]));
    const next = (n: number): number | undefined => map.get(n);
    const lines = body.split("\n");
    const fence = parseBlocks(body).find(b => b.kind === "code" && b.line === diagram.line);
    const last = fence === undefined ? diagram.line : endLine(fence);
    for (let i = diagram.line; i < last; i += 1) {
        lines[i] = (lines[i] ?? "").replaceAll(CIRCLED_ALL, c => {
            const n = leadingNumber(c);
            const to = n === null ? undefined : next(n);
            return to === undefined ? c : circled(to);
        });
    }
    for (const item of [...model.notes, ...model.changes]) {
        lines[item.line - 1] = replaceLeadingNumber(lines[item.line - 1] ?? "", next);
    }
    return lines.join("\n");
}

/** Adds the `classDef changed` line when a node is changed and the diagram has no such line. */
export function addChangedClassDef(body: string): string {
    const diagram = buildModel(body).diagram;
    if (diagram === null || diagram.hasChangedClassDef || !diagram.nodes.some(n => n.changed)) return body;
    const fence = parseBlocks(body).find(b => b.kind === "code" && b.line === diagram.line);
    if (fence === undefined) return body;
    const lines = body.split("\n");
    lines.splice(endLine(fence) - 1, 0, CHANGED_CLASS_DEF);
    return lines.join("\n");
}

function codeLines(blocks: readonly Block[]): Set<number> {
    const out = new Set<number>();
    for (const b of blocks) if (b.kind === "code") for (let l = b.line; l <= endLine(b); l += 1) out.add(l);
    return out;
}

/** `a.ts:3-3` becomes `a.ts:3`. Code blocks do not change. */
export function anchorStyle(body: string): string {
    const code = codeLines(parseBlocks(body));
    return body
        .split("\n")
        .map((line, i) => (code.has(i + 1) ? line : line.replaceAll(SHORT_RANGE, "`$1:$2`")))
        .join("\n");
}

function tableRow(line: string, delimiter: boolean): string {
    const cells = line
        .trim()
        .replace(/^\|/u, "")
        .replace(/(?<!\\)\|$/u, "")
        .split(PIPE)
        .map(c => c.trim());
    if (!delimiter) return `| ${cells.join(" | ")} |`;
    const marks = cells.map(c => `${c.startsWith(":") ? ":" : ""}---${c.endsWith(":") ? ":" : ""}`);
    return `|${marks.join("|")}|`;
}

/** Every table row becomes `| a | b |`, and the delimiter row becomes `|---|---|` (alignment kept). */
export function tableStyle(body: string): string {
    const lines = body.split("\n");
    for (const b of parseBlocks(body)) {
        if (b.kind !== "table") continue;
        for (let l = b.line; l <= endLine(b); l += 1) lines[l - 1] = tableRow(lines[l - 1] ?? "", l === b.line + 1);
    }
    return lines.join("\n");
}

/** Runs every fix. The output uses LF line ends. */
export function formatDigest(input: string, options: FmtOptions): FmtResult {
    const body = input.replaceAll(/\r\n?/gu, "\n");
    const moved = options.questionsToNotes ? questionsToNotes(body) : { body, questions: [] };
    const fixed = [orderSections, renumber, addChangedClassDef, anchorStyle, tableStyle].reduce(
        (text, fix) => fix(text),
        moved.body,
    );
    return { body: fixed, questions: moved.questions };
}
