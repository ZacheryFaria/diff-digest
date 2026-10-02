// Safe auto-fixes for a digest body (spec §9). Each fix keeps the meaning and never deletes
// content. Only `questionsToNotes` removes a section, and it returns the text it removed.
import { toLf } from "./digest";
import { SIZE_LABEL, SUMMARY_LABELS } from "./lint/mapping";
import { KNOWN_SECTIONS, QUESTIONS } from "./lint/structure";
import { codeLines, endLine, parseBlocks } from "./md";
import { buildModel, circled, leadingNumber } from "./model";

export const CHANGED_CLASS_DEF = "  classDef changed stroke:#ffc430,stroke-width:2px";

export interface FmtOptions {
    readonly questionsToNotes: boolean;
}

export interface FmtResult {
    readonly body: string;
    /** The questions that `questionsToNotes` removed: one per list item, and the text of each other block. */
    readonly questions: readonly string[];
}

const SHORT_RANGE = /`([\w@#./-]+\.\w+):(\d+)-\2`/gu;
const CIRCLED_ALL = /[①-⑳]/gu;
const PIPE = /(?<!\\)\|/u;

interface Chunk {
    readonly title: string | null;
    readonly text: string;
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

/** The place of a known section in KNOWN_SECTIONS, or -1 for the preamble and every other section. */
function rank(title: string | null): number {
    if (title === null) return -1;
    return KNOWN_SECTIONS.findIndex(k => k.toLowerCase() === title.toLowerCase());
}

/**
 * Sorts the known sections among the places that known sections have. The preamble and every other
 * section (unknown sections and Questions) stay where they are, so the order changes only when
 * `section-order` warns.
 */
export function orderSections(body: string): string {
    const all = chunks(body);
    const known = all.filter(c => rank(c.title) !== -1).toSorted((a, b) => rank(a.title) - rank(b.title));
    const sorted = all.map(c => (rank(c.title) === -1 ? c : (known.shift() ?? c)));
    if (sorted.every((c, i) => c === all[i])) return body;
    return join(sorted.map(c => c.text));
}

function isQuestions(c: Chunk): boolean {
    return c.title !== null && QUESTIONS.test(c.title);
}

/** Removes the Questions section. Returns one question per list item and the text of every other block. */
export function questionsToNotes(body: string): FmtResult {
    const all = chunks(body);
    const questions: string[] = [];
    for (const c of all.filter(chunk => isQuestions(chunk))) {
        // The first block is the section heading.
        for (const b of parseBlocks(c.text).slice(1)) {
            if (b.kind === "list") questions.push(...b.items.map(item => item.text.trim()));
            else questions.push(b.raw.trim());
        }
    }
    if (!all.some(chunk => isQuestions(chunk))) return { body, questions };
    return { body: join(all.filter(chunk => !isQuestions(chunk)).map(c => c.text)), questions };
}

/** Maps every circled number in the line. A number that is not in the map does not change. */
function mapNumbers(line: string, next: (n: number) => number | undefined): string {
    return line.replaceAll(CIRCLED_ALL, c => {
        const n = leadingNumber(c);
        const to = n === null ? undefined : next(n);
        return to === undefined ? c : circled(to);
    });
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
    for (let i = diagram.line; i < last; i += 1) lines[i] = mapNumbers(lines[i] ?? "", next);
    for (const item of [...model.notes, ...model.changes])
        for (let l = item.line; l <= item.endLine; l += 1) lines[l - 1] = mapNumbers(lines[l - 1] ?? "", next);
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
    const body = toLf(input);
    const moved = options.questionsToNotes ? questionsToNotes(body) : { body, questions: [] };
    const fixed = [orderSections, renumber, addChangedClassDef, anchorStyle, tableStyle].reduce(
        (text, fix) => fix(text),
        moved.body,
    );
    return { body: fixed, questions: moved.questions };
}

const SIZE_ITEM = new RegExp(`^- ${SIZE_LABEL.replaceAll("*", String.raw`\*`)}.*$`, "mu");
const SUMMARY_ITEM = new RegExp(`^- (?:${SUMMARY_LABELS.map(l => l.replaceAll("*", String.raw`\*`)).join("|")})`, "mu");

/** The counts in the summary's Size line. `fmt` gets them from the diff, so the agent does not count. */
export interface SizeCounts {
    readonly reviewableLines: number;
    readonly commits: number;
}

function sizeText(digestLines: number, counts: SizeCounts): string {
    const commits = `${counts.commits} commit${counts.commits === 1 ? "" : "s"}`;
    return `- ${SIZE_LABEL} ${digestLines} digest lines for ${counts.reviewableLines} reviewable diff lines in ${commits}.`;
}

/** Puts `line` as the summary's Size item: in place of the old one, first in the summary list, or below the title. */
function placeSizeLine(body: string, line: string): string {
    const h2 = body.search(/^## /mu);
    const pre = h2 === -1 ? body : body.slice(0, h2);
    const rest = body.slice(pre.length);
    if (SIZE_ITEM.test(pre)) return pre.replace(SIZE_ITEM, line) + rest;
    const summary = SUMMARY_ITEM.exec(pre);
    if (summary !== null) return `${pre.slice(0, summary.index)}${line}\n${pre.slice(summary.index)}${rest}`;
    const title = /^# .*$/mu.exec(pre);
    if (title === null) return body;
    const at = title.index + title[0].length;
    return `${pre.slice(0, at)}\n\n${line}${pre.slice(at)}${rest}`;
}

/** The body with an up-to-date Size line in its summary. A body with no H1 title is not changed. */
export function withSizeLine(body: string, counts: SizeCounts): string {
    const draft = placeSizeLine(body, sizeText(0, counts));
    const digestLines = draft.split("\n").filter(l => l.trim() !== "").length;
    return placeSizeLine(draft, sizeText(digestLines, counts));
}
