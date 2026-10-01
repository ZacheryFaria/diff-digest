import type { LintIssue } from "../schemas";
import { issue, type LintRule } from "./rule";

export const KNOWN_SECTIONS: readonly string[] = ["Architecture", "Changes", "Tests"];

export const QUESTIONS = /^questions?$/iu;

export const sectionOrder: LintRule = {
    id: "section-order",
    severity: "warn",
    description: `The known sections are in this order: ${KNOWN_SECTIONS.join(", ")}.`,
    check: ({ model }) => {
        const out: LintIssue[] = [];
        let last = -1;
        for (const section of model.sections) {
            const at = KNOWN_SECTIONS.findIndex(k => k.toLowerCase() === section.title.toLowerCase());
            if (at === -1) continue;
            if (at < last)
                out.push(
                    issue(sectionOrder, section.line, `"${section.title}" is out of order.`, "Run `diff-digest fmt`."),
                );
            last = Math.max(last, at);
        }
        return out;
    },
};

export const unknownSection: LintRule = {
    id: "unknown-section",
    severity: "warn",
    description: "A section is not in the format.",
    check: ({ model }) =>
        model.sections
            .filter(
                s => !QUESTIONS.test(s.title) && !KNOWN_SECTIONS.some(k => k.toLowerCase() === s.title.toLowerCase()),
            )
            .map(s => issue(unknownSection, s.line, `"${s.title}" is not a section of the format.`)),
};

export const noQuestions: LintRule = {
    id: "no-questions",
    severity: "warn",
    description: "No Questions section. Use agent notes.",
    check: ({ model }) =>
        model.sections
            .filter(s => QUESTIONS.test(s.title))
            .map(s =>
                issue(
                    noQuestions,
                    s.line,
                    "The digest has a Questions section.",
                    "Run `diff-digest fmt --questions-to-notes`.",
                ),
            ),
};
