// Shared types and helpers for the lint rules.
import type { Anchor } from "../digest";
import { flatBlocks, type Block, type Inline } from "../md";
import type { DigestModel } from "../model";
import type { LintIssue, LintSeverity } from "../schemas";

export interface LintContext {
    /** null when the anchor resolves to a file and a line range that exists; else a message. */
    readonly checkAnchor: (anchor: Anchor) => string | null;
}

export interface LintInput {
    readonly model: DigestModel;
    readonly frontmatterError: string | null;
    readonly ctx: LintContext;
}

export interface LintRule {
    readonly id: string;
    readonly severity: LintSeverity;
    readonly description: string;
    readonly check: (input: LintInput) => LintIssue[];
}

export interface LineInline {
    readonly line: number;
    readonly inline: readonly Inline[];
}

/** The inline content of each line, also in nested lists and blockquotes. Code blocks have none. */
export function inlineLines(all: readonly Block[]): LineInline[] {
    const out: LineInline[] = [];
    for (const b of flatBlocks(all)) {
        switch (b.kind) {
            case "heading":
            case "paragraph": {
                out.push({ line: b.line, inline: b.inline });
                break;
            }
            case "list": {
                for (const item of b.items) out.push({ line: item.line, inline: item.inline });
                break;
            }
            case "table": {
                out.push({ line: b.line, inline: b.header.flatMap(c => c.inline) });
                for (const [i, row] of b.rows.entries())
                    out.push({ line: b.line + 2 + i, inline: row.flatMap(c => c.inline) });
                break;
            }
            case "blockquote":
            case "code":
            case "html":
            case "def":
            case "other": {
                break;
            }
        }
    }
    return out;
}

export function issue(rule: LintRule, line: number, message: string, hint?: string): LintIssue {
    return { rule: rule.id, severity: rule.severity, line, message, ...(hint === undefined ? {} : { hint }) };
}
