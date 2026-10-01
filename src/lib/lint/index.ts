// Lint rules for a digest (spec §9). Errors are facts that are wrong; warnings are best practices.
// No rule rejects valid Markdown.
import { DigestError } from "../errors";
import { toLf } from "../digest";
import { FRONTMATTER, parseDigest } from "../frontmatter";
import { buildModel } from "../model";
import type { LintIssue } from "../schemas";
import { anchorResolves, linkStyle, noInlineHtml, noIntent, noWikilinks, tableMaxColumns } from "./content";
import { changedNodeMarked, diagramNotes, diagramSize, nodeNumbers } from "./diagram";
import { frontmatter } from "./frontmatter";
import type { LintContext, LintInput, LintRule } from "./rule";
import { noQuestions, sectionOrder, unknownSection } from "./structure";

export type { LintContext, LintRule } from "./rule";
export { INTENT_PHRASES, MAX_TABLE_COLUMNS } from "./content";
export { MAX_DIAGRAM_NODES } from "./diagram";
export { KNOWN_SECTIONS } from "./structure";

export const RULES: readonly LintRule[] = [
    frontmatter,
    anchorResolves,
    nodeNumbers,
    changedNodeMarked,
    diagramNotes,
    diagramSize,
    sectionOrder,
    unknownSection,
    noQuestions,
    noIntent,
    noInlineHtml,
    noWikilinks,
    linkStyle,
    tableMaxColumns,
];

/** Lints a full digest file (frontmatter + body). Issues are sorted by line. CRLF counts as one line end. */
export function lintDigest(file: string, ctx: LintContext): LintIssue[] {
    const md = toLf(file);
    let frontmatterError: string | null = null;
    let body = md.replace(FRONTMATTER, "");
    try {
        body = parseDigest(md).body;
    } catch (error) {
        if (!(error instanceof DigestError)) throw error;
        frontmatterError = error.message;
    }
    const lineOffset = md.slice(0, md.length - body.length).split("\n").length - 1;
    const input: LintInput = { model: buildModel(body, lineOffset), frontmatterError, ctx };
    return RULES.flatMap(rule => rule.check(input)).toSorted((a, b) => a.line - b.line);
}

export function hasErrors(issues: readonly LintIssue[]): boolean {
    return issues.some(i => i.severity === "error");
}

/** The rule table that `diff-digest format` prints after docs/format.md. */
export function formatRulesMarkdown(): string {
    const rows = RULES.map(r => `| \`${r.id}\` | ${r.severity} | ${r.description.replaceAll("|", String.raw`\|`)} |`);
    return ["## Lint rules", "", "| Rule | Severity | Check |", "|---|---|---|", ...rows, ""].join("\n");
}
