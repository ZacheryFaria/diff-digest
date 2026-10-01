import { anchors } from "../digest";
import { flatBlocks } from "../md";
import type { LintIssue } from "../schemas";
import { inlineLines, issue, type LintRule } from "./rule";

export const MAX_TABLE_COLUMNS = 5;
export const INTENT_PHRASES: readonly string[] = [
    "in order to",
    "the author",
    "intended to",
    "we want",
    "the goal",
    "to make it easier",
];

const WIKILINK = /\[\[[^\]]+\]\]/u;

export const anchorResolves: LintRule = {
    id: "anchor-resolves",
    severity: "error",
    description: "Each anchor resolves to a file and a line range that exists.",
    check: ({ model, ctx }) => {
        const out: LintIssue[] = [];
        for (const { line, inline } of inlineLines(model.all)) {
            for (const span of inline) {
                if (span.kind !== "code") continue;
                for (const a of anchors(`\`${span.text}\``)) {
                    const problem = ctx.checkAnchor(a);
                    if (problem !== null) out.push(issue(anchorResolves, line, problem));
                }
            }
        }
        return out;
    },
};

export const noIntent: LintRule = {
    id: "no-intent",
    severity: "warn",
    description: `No intent phrases: ${INTENT_PHRASES.map(p => `\`${p}\``).join(", ")}.`,
    check: ({ model }) => {
        const out: LintIssue[] = [];
        for (const block of model.blocks) {
            const lower = block.text.toLowerCase();
            for (const phrase of INTENT_PHRASES) {
                if (lower.includes(phrase))
                    out.push(
                        issue(noIntent, block.line, `"${phrase}" guesses the intent. Describe what the code does.`),
                    );
            }
        }
        return out;
    },
};

export const noInlineHtml: LintRule = {
    id: "no-inline-html",
    severity: "warn",
    description: "No HTML in the body. Some viewers do not render it.",
    check: ({ model }) => {
        const out: LintIssue[] = [];
        for (const b of flatBlocks(model.all))
            if (b.kind === "html") out.push(issue(noInlineHtml, b.line, "HTML block."));
        for (const { line, inline } of inlineLines(model.all)) {
            if (inline.some(i => i.kind === "html")) out.push(issue(noInlineHtml, line, "Inline HTML."));
        }
        return out;
    },
};

export const noWikilinks: LintRule = {
    id: "no-wikilinks",
    severity: "warn",
    description: "No `[[x]]` links. Only Obsidian renders them.",
    check: ({ model }) =>
        inlineLines(model.all)
            .filter(({ inline }) => inline.some(i => i.kind === "text" && WIKILINK.test(i.text)))
            .map(({ line }) => issue(noWikilinks, line, "Wikilink.", "Use a standard [text](url) link.")),
};

export const linkStyle: LintRule = {
    id: "link-style",
    severity: "warn",
    description: "Only standard `[text](url)` links and autolinks.",
    check: ({ model }) => {
        const out: LintIssue[] = [];
        for (const b of flatBlocks(model.all))
            if (b.kind === "def") out.push(issue(linkStyle, b.line, "Reference link definition."));
        for (const { line, inline } of inlineLines(model.all)) {
            for (const i of inline) {
                if (i.kind === "link" && i.raw.startsWith("[") && !i.raw.includes("](")) {
                    out.push(issue(linkStyle, line, `Reference link ${i.raw}.`, "Use [text](url)."));
                }
            }
        }
        return out;
    },
};

export const tableMaxColumns: LintRule = {
    id: "table-max-columns",
    severity: "warn",
    description: `Tables have at most ${MAX_TABLE_COLUMNS} columns, so they fit in a terminal viewer.`,
    check: ({ model }) =>
        flatBlocks(model.all)
            .filter(b => b.kind === "table" && b.header.length > MAX_TABLE_COLUMNS)
            .map(b => issue(tableMaxColumns, b.line, `The table has more than ${MAX_TABLE_COLUMNS} columns.`)),
};
