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
        expect(out.indexOf("## Architecture")).toBeLessThan(out.indexOf("## Changes"));
        expect(out.indexOf("## Changes")).toBeLessThan(out.indexOf("## Tests"));
        expect(out.indexOf("## Tests")).toBeLessThan(out.indexOf("## Questions"));
        expect(out).toContain("- Q1: does x happen?");
    });

    test("questionsToNotes removes the section and returns its items", () => {
        const { body, questions } = questionsToNotes(MESSY);
        expect(body).not.toContain("## Questions");
        expect(questions).toEqual(["Q1: does x happen?"]);
    });

    test("renumber follows the diagram order in the diagram, the notes, and Changes", () => {
        const out = renumber(orderSections(MESSY));
        expect(out).toContain('api["① API"]:::changed --> view["② View"]:::changed');
        expect(out).toContain("1. ① api retries.\n2. ② view badge.");
        expect(out).toContain("- ① retry:");
        expect(out).toContain("- ② view:");
    });

    test("addChangedClassDef adds the line before the closing fence", () => {
        expect(addChangedClassDef(MESSY)).toContain(`:::changed\n${CHANGED_CLASS_DEF}\n\`\`\``);
    });

    test("anchorStyle shortens a one-line range and leaves code blocks alone", () => {
        const out = anchorStyle("- `a.ts:3-3` and `b.ts:3-4`\n\n```\n`c.ts:5-5`\n```\n");
        expect(out).toBe("- `a.ts:3` and `b.ts:3-4`\n\n```\n`c.ts:5-5`\n```\n");
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
