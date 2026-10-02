// "Every line maps to code": each note, bullet, and table row in the mapped sections has an anchor, or a
// parent bullet or a `###` heading above it has one. A bullet with a nested list is a group label, and its
// nested bullets need the anchors. And the summary block below the title.
import { anchors } from "../digest";
import type { Block, Inline, ListItem } from "../md";
import type { LintIssue } from "../schemas";
import { issue, type LintRule } from "./rule";

/** The sections whose lines must map to code. */
export const MAPPED_SECTIONS: readonly string[] = ["Architecture", "Changes", "Tests"];
/** In Tests, a short statement such as "No tests changed." has no code to point at. */
const PROSE_ALLOWED = "tests";

export const SIZE_LABEL = "**Size:**";
export const SUMMARY_LABELS: readonly string[] = ["**What it does:**", "**New modules:**", "**Changes you can see:**"];

function hasAnchor(inline: readonly Inline[]): boolean {
    return inline.some(i => i.kind === "code" && anchors(`\`${i.text}\``).length > 0);
}

function rowIssues(rule: LintRule, block: Extract<Block, { kind: "table" }>, covered: boolean): LintIssue[] {
    if (covered) return [];
    return block.rows.flatMap((row, i) =>
        row.some(c => hasAnchor(c.inline))
            ? []
            : [
                  issue(
                      rule,
                      block.line + 2 + i,
                      "This table row has no anchor.",
                      "Add one, or put one in the ### heading above the table.",
                  ),
              ],
    );
}

function itemIssues(rule: LintRule, items: readonly ListItem[], covered: boolean): LintIssue[] {
    return items.flatMap(item => {
        const own = hasAnchor(item.inline);
        // A bullet with a nested list is a group label: its nested bullets carry the anchors.
        const group = item.children.some(c => c.kind === "list");
        const here =
            own || covered || group
                ? []
                : [
                      issue(
                          rule,
                          item.line,
                          "This line has no anchor.",
                          "Add `path:line`, or put one in a parent bullet.",
                      ),
                  ];
        return [...here, ...blocksIssues(rule, item.children, own || covered, true)];
    });
}

/** `covered`: a parent bullet or a `###` heading above has an anchor. `prose`: a paragraph is allowed. */
function blocksIssues(rule: LintRule, blocks: readonly Block[], covered: boolean, prose: boolean): LintIssue[] {
    let under = covered;
    return blocks.flatMap(b => {
        if (b.kind === "heading") {
            under = covered || hasAnchor(b.inline);
            return [];
        }
        if (b.kind === "list") return itemIssues(rule, b.items, under);
        if (b.kind === "table") return rowIssues(rule, b, under);
        if (b.kind === "paragraph" && !prose && !under && !hasAnchor(b.inline))
            return [issue(rule, b.line, "This paragraph has no code to point at.", "Use a bullet with an anchor.")];
        return [];
    });
}

export const mapsToCode: LintRule = {
    id: "maps-to-code",
    severity: "warn",
    description: `Each note, bullet, and table row in ${MAPPED_SECTIONS.join(", ")} has an anchor, or a parent bullet or a \`###\` heading above it has one.`,
    check: ({ model }) =>
        model.sections
            .filter(s => MAPPED_SECTIONS.some(m => m.toLowerCase() === s.title.toLowerCase()))
            .flatMap(s => blocksIssues(mapsToCode, s.blocks, false, s.title.toLowerCase() === PROSE_ALLOWED)),
};

function summaryList(preamble: readonly Block[]): Extract<Block, { kind: "list" }> | undefined {
    return preamble
        .filter(b => b.kind === "list")
        .find(b => b.items.some(i => [SIZE_LABEL, ...SUMMARY_LABELS].some(l => i.ownText.startsWith(l))));
}

export const summary: LintRule = {
    id: "summary",
    severity: "warn",
    description: `Below the title, a summary list: ${SIZE_LABEL} (\`fmt\` writes it), ${SUMMARY_LABELS.join(", ")}. Each item except Size has an anchor.`,
    check: ({ model }) => {
        const line = model.title?.line ?? 1;
        const list = summaryList(model.preamble);
        if (list === undefined)
            return [
                issue(
                    summary,
                    line,
                    "The digest has no summary below the title.",
                    "Run `diff-digest fmt`, then add the items.",
                ),
            ];
        const has = (label: string): boolean => list.items.some(i => i.ownText.startsWith(label));
        const missing = [SIZE_LABEL, SUMMARY_LABELS[0] ?? ""].filter(l => !has(l));
        const unanchored = itemIssues(
            summary,
            list.items.filter(i => !i.ownText.startsWith(SIZE_LABEL)),
            false,
        );
        return [...missing.map(l => issue(summary, list.line, `The summary has no ${l} item.`)), ...unanchored];
    },
};
