import { describe, expect, test } from "bun:test";
import { assignDigestComments, blockIndex, tableRowLine } from "../../src/app/comments-map";
import { parseBlocks, type Block } from "../../src/lib/md";
import { buildModel, type ModelBlock } from "../../src/lib/model";
import type { Comment, CommentTarget } from "../../src/lib/schemas";

function comment(id: string, target: CommentTarget): Comment {
    return { id, created: "2026-10-01T00:00:00.000Z", author: "user", status: "open", target, body: "b" };
}

function digest(cid: string, line?: number): CommentTarget {
    return { kind: "digest", cid, section: "", text: "t", ...(line === undefined ? {} : { line }) };
}

const BLOCKS: readonly ModelBlock[] = [
    { cid: "a", section: "", text: "A", line: 3 },
    { cid: "same", section: "", text: "S", line: 6 },
    { cid: "same", section: "", text: "S", line: 12 },
];

describe("assignDigestComments", () => {
    test("keeps a comment on its block when the block moves to a different line", () => {
        const c = comment("c1", digest("a", 2));
        const { byBlock, others } = assignDigestComments(BLOCKS, [c]);
        expect(byBlock.get(3)).toEqual([c]);
        expect(others).toEqual([]);
    });

    test("chooses between equal cids by the exact line, else by the nearest line", () => {
        const exact = comment("c1", digest("same", 12));
        const near = comment("c2", digest("same", 7));
        const far = comment("c3", digest("same", 14));
        const { byBlock } = assignDigestComments(BLOCKS, [exact, near, far]);
        expect(byBlock.get(6)).toEqual([near]);
        expect(byBlock.get(12)).toEqual([exact, far]);
    });

    test("puts a comment with no line on the first block with its cid", () => {
        const c = comment("c1", digest("same"));
        expect(assignDigestComments(BLOCKS, [c]).byBlock.get(6)).toEqual([c]);
    });

    test("puts a comment whose cid is gone, and each code comment, in the others", () => {
        const gone = comment("c1", digest("missing", 3));
        const code = comment("c2", { kind: "code", path: "a.ts", rev: "head", line: 1, text: "" });
        const { byBlock, others } = assignDigestComments(BLOCKS, [gone, code]);
        expect(byBlock.size).toBe(0);
        expect(others).toEqual([gone, code]);
    });
});

/** The file lines that the renderer asks `blockAt` for (see markdown/Blocks.tsx). */
function rendererLines(blocks: readonly Block[], offset: number): { readonly line: number; readonly text: string }[] {
    return blocks.flatMap(b => {
        if (b.kind === "heading" || b.kind === "paragraph") return [{ line: b.line + offset, text: b.text }];
        if (b.kind === "code") return [{ line: b.line + offset, text: b.text }];
        if (b.kind === "blockquote") return rendererLines(b.children, offset);
        if (b.kind === "table")
            return b.rows.map((row, i) => ({
                line: tableRowLine(b, i) + offset,
                text: row.map(c => c.text).join(" | "),
            }));
        if (b.kind === "list")
            return b.items.flatMap(item => [
                { line: item.line + offset, text: item.ownText },
                ...rendererLines(item.children, offset),
            ]);
        return [];
    });
}

describe("blockIndex", () => {
    const body = [
        "# Title",
        "",
        "## Changes",
        "",
        "- one",
        "  - nested",
        "- two",
        "",
        "> quoted",
        "",
        "| a | b |",
        "|---|---|",
        "| r1 | x |",
        "| r2 | y |",
        "",
        "```ts",
        "code",
        "```",
        "",
    ].join("\n");

    test("finds the model block for each line that the renderer asks for, with the frontmatter offset", () => {
        const offset = 4;
        const at = blockIndex(buildModel(body, offset).blocks);
        const lines = rendererLines(parseBlocks(body), offset);
        expect(lines.map(l => at(l.line)?.text)).toEqual([
            "Title",
            "Changes",
            "one",
            "nested",
            "two",
            "quoted",
            "r1 | x",
            "r2 | y",
            "code",
        ]);
        expect(lines.map(l => l.line)).toEqual([5, 7, 9, 10, 11, 13, 17, 18, 20]);
    });
});
