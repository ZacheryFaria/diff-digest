import { describe, expect, test } from "bun:test";
import {
    addChangedClassDef,
    anchorStyle,
    CHANGED_CLASS_DEF,
    formatDigest,
    orderSections,
    questionsToNotes,
    renumber,
    tableStyle,
} from "../../src/lib/fmt";
import { GOOD_BODY } from "../fixtures/digest";

const MESSY = `# Title

## Tests

| Test|Proves |
|:--|--:|
|t|x|

## Questions

- Q1: does x happen?

## Changes

- ③ retry: \`src/api.ts:10-10\`
- ① view: \`v.ts:2\`

## Architecture

\`\`\`mermaid
flowchart LR
  api["③ API"]:::changed --> view["① View"]:::changed
\`\`\`

1. ③ api retries.
2. ① view badge.
`;

describe("fmt fixes", () => {
    test("orderSections puts known sections in order and keeps all text", () => {
        const out = orderSections(MESSY);
        // The known sections take the places that known sections had. Questions keeps its place.
        expect(out.indexOf("## Architecture")).toBeLessThan(out.indexOf("## Questions"));
        expect(out.indexOf("## Questions")).toBeLessThan(out.indexOf("## Changes"));
        expect(out.indexOf("## Changes")).toBeLessThan(out.indexOf("## Tests"));
        expect(out).toContain("- Q1: does x happen?");
    });

    test("orderSections does not move an unknown section", () => {
        const body = "# T\n\n## Summary\n\ntext\n\n## Architecture\n\nx\n";
        expect(orderSections(body)).toBe(body);
    });

    test("orderSections swaps Changes and Tests, and an unknown section between them stays", () => {
        const body = "## Architecture\n\na\n\n## Tests\n\nt\n\n## Notes\n\nn\n\n## Changes\n\nc\n";
        expect(orderSections(body)).toBe("## Architecture\n\na\n\n## Changes\n\nc\n\n## Notes\n\nn\n\n## Tests\n\nt\n");
    });

    test("questionsToNotes removes the section and returns its items", () => {
        const { body, questions } = questionsToNotes(MESSY);
        expect(body).not.toContain("## Questions");
        expect(questions).toEqual(["Q1: does x happen?"]);
    });

    test("questionsToNotes keeps every block of the section", () => {
        const body = "# T\n\n## Questions\n\n- Why x?\n\n```ts\nconst y = 1;\n```\n\n> Is z safe?\n> Check it.\n";
        const { body: out, questions } = questionsToNotes(body);
        expect(out).toBe("# T\n");
        expect(questions).toEqual(["Why x?", "```ts\nconst y = 1;\n```", "> Is z safe?\n> Check it."]);
    });

    test("renumber follows the diagram order in the diagram, the notes, and Changes", () => {
        const out = renumber(orderSections(MESSY));
        expect(out).toContain('api["① API"]:::changed --> view["② View"]:::changed');
        expect(out).toContain("1. ① api retries.\n2. ② view badge.");
        expect(out).toContain("- ① retry:");
        expect(out).toContain("- ② view:");
    });

    test("renumber maps every circled number on the notes and Changes lines", () => {
        const body = [
            "## Architecture",
            "",
            "```mermaid",
            "flowchart LR",
            '  b["② B"]:::changed --> a["① A"]:::changed',
            "```",
            "",
            "1. ② B reads the file. It feeds ①.",
            "2. ① A writes",
            "   the cache for ②.",
            "",
            "## Changes",
            "",
            "- ① A uses ②: `a.ts:1`",
            "- ② B: `b.ts:1`",
            "",
        ].join("\n");
        const out = renumber(body);
        expect(out).toContain('b["① B"]:::changed --> a["② A"]:::changed');
        expect(out).toContain("1. ① B reads the file. It feeds ②.\n2. ② A writes\n   the cache for ①.");
        expect(out).toContain("- ② A uses ①: `a.ts:1`\n- ① B: `b.ts:1`");
    });

    test("addChangedClassDef adds the line before the closing fence", () => {
        expect(addChangedClassDef(MESSY)).toContain(`:::changed\n${CHANGED_CLASS_DEF}\n\`\`\``);
    });

    test("anchorStyle shortens a one-line range and leaves code blocks alone", () => {
        const out = anchorStyle("- `a.ts:3-3` and `b.ts:3-4`\n\n```\n`c.ts:5-5`\n```\n");
        expect(out).toBe("- `a.ts:3` and `b.ts:3-4`\n\n```\n`c.ts:5-5`\n```\n");
    });

    test("anchorStyle leaves a code block in a list item alone", () => {
        const body = "- item\n\n  ```\n  `c.ts:5-5`\n  ```\n";
        expect(anchorStyle(body)).toBe(body);
    });

    test("tableStyle uses one row style and keeps alignment and escaped pipes", () => {
        expect(tableStyle("| a|b \\| c |\n|:--|--:|\n|1|2|\n")).toBe("| a | b \\| c |\n|:---|---:|\n| 1 | 2 |\n");
    });
});

describe("formatDigest", () => {
    test("does not change a good digest", () => {
        expect(formatDigest(GOOD_BODY, { questionsToNotes: true }).body).toBe(GOOD_BODY);
    });

    test("gives the same result for CRLF input, with LF line ends", () => {
        const crlf = MESSY.replaceAll("\n", "\r\n");
        expect(formatDigest(crlf, { questionsToNotes: true })).toEqual(formatDigest(MESSY, { questionsToNotes: true }));
    });

    test("is idempotent", () => {
        const once = formatDigest(MESSY, { questionsToNotes: true });
        expect(once.questions).toEqual(["Q1: does x happen?"]);
        expect(formatDigest(once.body, { questionsToNotes: true })).toEqual({ body: once.body, questions: [] });
        const keep = formatDigest(MESSY, { questionsToNotes: false });
        expect(keep.body).toContain("## Questions");
        expect(formatDigest(keep.body, { questionsToNotes: false }).body).toBe(keep.body);
    });
});
