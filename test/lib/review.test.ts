import { describe, expect, test } from "bun:test";
import { reviewMarkdown } from "../../src/lib/review";
import type { Comment } from "../../src/lib/schemas";

const BASE = { created: "2026-10-01T00:00:00.000Z", author: "user", status: "open" } as const;
const COMMENTS: Comment[] = [
    {
        ...BASE,
        id: "c1",
        body: "Why two?",
        target: { kind: "code", path: "src/lib/a.ts", rev: "head", line: 4, endLine: 6, text: "  x = 2\ny" },
    },
    {
        ...BASE,
        id: "c2",
        body: "Unclear.",
        target: { kind: "digest", cid: "k", section: "Changes", text: "The | pipe" },
    },
    {
        ...BASE,
        id: "c3",
        status: "resolved",
        body: "Done.",
        target: { kind: "digest", cid: "k", section: "", text: "x" },
    },
    {
        ...BASE,
        id: "c4",
        author: "agent",
        status: "note",
        body: "Note.",
        target: { kind: "digest", cid: "k", section: "", text: "x" },
    },
];

describe("reviewMarkdown", () => {
    test("lists only open user comments, digest first, then code with ranges", () => {
        expect(reviewMarkdown(COMMENTS)).toBe(
            [
                "### Comments on the digest and code",
                "",
                "**On the digest**",
                "",
                "- **Changes** · “The \\| pipe”",
                "  Unclear.",
                "",
                "**On the code**",
                "",
                "- `lib/a.ts:4-6` (after) — `x = 2`",
                "  Why two?",
                "",
            ].join("\n"),
        );
    });

    test("uses the linker for code labels, and says when nothing is open", () => {
        expect(reviewMarkdown(COMMENTS, (path, line, end) => `https://x/${path}#L${line}-L${end}`)).toContain(
            "[`lib/a.ts:4-6`](https://x/src/lib/a.ts#L4-L6)",
        );
        expect(reviewMarkdown([])).toContain("_No open comments._");
    });
});
