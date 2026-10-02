// Lint rules for a digest (spec §9). Errors are facts that are wrong; warnings are best practices.
// No rule rejects valid Markdown.
import { DigestError } from "../errors";
import { bodyLineOffset, toLf } from "../digest";
import { FRONTMATTER, parseDigest } from "../frontmatter";
import { buildModel } from "../model";
import type { LintIssue } from "../schemas";
import type { LintContext, LintInput } from "./rule";
import { RULES } from "./rules";

export type { LintContext, LintRule } from "./rule";
export * from "./rules";

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
    const input: LintInput = { model: buildModel(body, bodyLineOffset(md, body)), frontmatterError, ctx };
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
