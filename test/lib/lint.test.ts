import { describe, expect, test } from "bun:test";
import { formatRulesMarkdown, hasErrors, lintDigest, RULES, type LintContext } from "../../src/lib/lint";
import { FRONTMATTER, GOOD_BODY } from "../fixtures/digest";

const OK: LintContext = { checkAnchor: () => null };

function rules(body: string, ctx: LintContext = OK): string[] {
    return lintDigest(`${FRONTMATTER}${body}`, ctx).map(i => i.rule);
}

describe("lintDigest", () => {
    test("a good digest has no issues", () => {
        expect(lintDigest(`${FRONTMATTER}${GOOD_BODY}`, OK)).toEqual([]);
    });

    test("valid but unusual Markdown gives no errors", () => {
        const body = `${GOOD_BODY}\n## Notes\n\n> [!NOTE]\n> A callout.\n\n- [ ] task\n\n~~old~~ <https://x.dev>\n\n---\n\n<div>raw</div>\n`;
        const issues = lintDigest(`${FRONTMATTER}${body}`, OK);
        expect(hasErrors(issues)).toBe(false);
        expect(issues.length).toBeGreaterThan(0);
    });

    test("frontmatter: a missing or bad frontmatter is an error on line 1", () => {
        const [issue] = lintDigest(GOOD_BODY, OK);
        expect(issue).toMatchObject({ rule: "frontmatter", severity: "error", line: 1 });
    });

    test("anchor-resolves: a bad anchor is an error on its file line", () => {
        const ctx: LintContext = { checkAnchor: a => (a.path === "src/view.tsx" ? "No such file" : null) };
        expect(lintDigest(`${FRONTMATTER}${GOOD_BODY}`, ctx)).toEqual([
            { rule: "anchor-resolves", severity: "error", line: 29, message: "No such file" },
        ]);
    });

    test("anchor-resolves: an anchor in a table header is checked too", () => {
        const body = `${GOOD_BODY}\n| \`bad.ts:1\` | b |\n|---|---|\n| 1 | 2 |\n`;
        const ctx: LintContext = { checkAnchor: a => (a.path === "bad.ts" ? "No such file" : null) };
        expect(lintDigest(`${FRONTMATTER}${body}`, ctx).map(i => [i.rule, i.line])).toEqual([["anchor-resolves", 37]]);
    });

    test("anchor-resolves: an anchor in a nested Changes bullet is checked", () => {
        const body = GOOD_BODY.replace("`src/view.tsx:3`\n", "`src/view.tsx:3`\n  - Nested: `bad.ts:4`\n");
        const checked: string[] = [];
        const ctx: LintContext = {
            checkAnchor: a => {
                checked.push(a.path);
                return a.path === "bad.ts" ? "No such file" : null;
            },
        };
        expect(lintDigest(`${FRONTMATTER}${body}`, ctx).map(i => [i.rule, i.line])).toEqual([["anchor-resolves", 30]]);
        expect(checked).toContain("bad.ts");
    });

    test("anchor-resolves: an anchor in a list inside a callout is checked", () => {
        const body = `${GOOD_BODY}\n> [!NOTE]\n> See:\n> - \`bad.ts:1\`\n`;
        const ctx: LintContext = { checkAnchor: a => (a.path === "bad.ts" ? "No such file" : null) };
        expect(lintDigest(`${FRONTMATTER}${body}`, ctx).map(i => [i.rule, i.line])).toEqual([["anchor-resolves", 39]]);
    });

    test("no-inline-html and no-wikilinks: a nested bullet is checked", () => {
        const body = GOOD_BODY.replace("`src/view.tsx:3`\n", "`src/view.tsx:3`\n  - A <b>bold</b> [[x]] word.\n");
        expect(lintDigest(`${FRONTMATTER}${body}`, OK).map(i => [i.rule, i.line])).toEqual([
            ["no-inline-html", 30],
            ["no-wikilinks", 30],
        ]);
    });

    test("node-numbers: each skipped number is reported", () => {
        const body = GOOD_BODY.replace("② List view", "⑤ List view")
            .replace("2. ②", "2. ⑤")
            .replace("- ② The badge", "- ⑤ The badge");
        const messages = lintDigest(`${FRONTMATTER}${body}`, OK)
            .filter(i => i.rule === "node-numbers")
            .map(i => i.message);
        expect(messages).toEqual(["The node numbers skip ②.", "The node numbers skip ③.", "The node numbers skip ④."]);
    });

    test("node-numbers: a skipped number, a duplicate, and an unknown Changes number", () => {
        expect(rules(GOOD_BODY.replace("② List view", "③ List view").replace("2. ②", "2. ③"))).toContain(
            "node-numbers",
        );
        expect(rules(GOOD_BODY.replace("② List view", "① List view"))).toContain("node-numbers");
        expect(rules(GOOD_BODY.replace("- ② The badge", "- ⑤ The badge"))).toEqual(["node-numbers"]);
    });

    test("changed-node-marked: a number without :::changed, and :::changed without a number", () => {
        expect(rules(GOOD_BODY.replace('view["② List view"]:::changed', 'view["② List view"]'))).toEqual([
            "changed-node-marked",
        ]);
        expect(rules(GOOD_BODY.replace("store[(Store)]", "store[(Store)]:::changed"))).toEqual(["changed-node-marked"]);
    });

    test("diagram-notes: a numbered node with no note, and a note that is not a node", () => {
        expect(rules(GOOD_BODY.replace("2. ② The list shows a retry badge.\n", ""))).toEqual(["diagram-notes"]);
        // ④ is not a node, and ② now has no note: two issues.
        expect(rules(GOOD_BODY.replace("2. ② The list", "2. ④ The list"))).toEqual(["diagram-notes", "diagram-notes"]);
    });

    test("diagram-size: more than 11 nodes", () => {
        const edges = Array.from({ length: 12 }, (_, i) => `  n${i} --> n${i + 1}`).join("\n");
        expect(rules(GOOD_BODY.replace("  store --> view", `${edges}\n  store --> view`))).toEqual(["diagram-size"]);
    });

    test("section-order, unknown-section, and no-questions", () => {
        const swapped = GOOD_BODY.replace("## Changes", "## Tmp")
            .replace("## Tests", "## Changes")
            .replace("## Tmp", "## Tests");
        expect(rules(swapped)).toContain("section-order");
        expect(rules(`${GOOD_BODY}\n## Rollout\n\ntext\n`)).toEqual(["unknown-section"]);
        expect(rules(`${GOOD_BODY}\n## Questions\n\n- Q1: why?\n`)).toEqual(["no-questions"]);
    });

    test("no-intent, no-inline-html, no-wikilinks, link-style, table-max-columns", () => {
        expect(rules(`${GOOD_BODY}\nThis exists in order to help.\n`)).toEqual(["no-intent"]);
        expect(rules(`${GOOD_BODY}\nA <b>bold</b> word.\n`)).toEqual(["no-inline-html"]);
        expect(rules(`${GOOD_BODY}\nSee [[Note]].\n`)).toEqual(["no-wikilinks"]);
        expect(rules(`${GOOD_BODY}\nSee [docs][d].\n\n[d]: https://x.dev\n`)).toEqual(["link-style", "link-style"]);
        expect(
            rules(`${GOOD_BODY}\n| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |\n`),
        ).toEqual(["table-max-columns"]);
    });

    test("formatRulesMarkdown lists every rule once", () => {
        const md = formatRulesMarkdown();
        for (const rule of RULES) expect(md).toContain(`| \`${rule.id}\` | ${rule.severity} |`);
        expect(RULES.filter(r => r.severity === "error").map(r => r.id)).toEqual([
            "frontmatter",
            "anchor-resolves",
            "node-numbers",
        ]);
    });
});
