import { describe, expect, test } from "bun:test";
import { parseBlocks } from "../../src/lib/md";

describe("parseBlocks", () => {
    test("gives each block its 1-based line", () => {
        const blocks = parseBlocks("# T\n\ntext\n\n- a\n- b\n");
        expect(blocks.map(b => [b.kind, b.line])).toEqual([
            ["heading", 1],
            ["paragraph", 3],
            ["list", 5],
        ]);
    });

    test("counts a CRLF line end as one line", () => {
        expect(parseBlocks("# T\r\n\r\n## A\r\n\r\n- a\r\n").map(b => [b.kind, b.line])).toEqual([
            ["heading", 1],
            ["heading", 3],
            ["list", 5],
        ]);
    });

    test("gives each list item its line and its inline code", () => {
        const [list] = parseBlocks("- a `x.ts:1`\n- **b**\n");
        if (list?.kind !== "list") throw new Error("expected a list");
        expect(list.items.map(i => [i.line, i.text])).toEqual([
            [1, "a `x.ts:1`"],
            [2, "**b**"],
        ]);
        expect(list.items[0]?.inline).toEqual([
            { kind: "text", text: "a " },
            { kind: "code", text: "x.ts:1" },
        ]);
        expect(list.items[1]?.inline).toEqual([{ kind: "text", text: "b" }]);
    });

    test("reads tables, code, HTML, links, and link definitions", () => {
        const md =
            "| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nx\n```\n\n<div>x</div>\n\n[r]: http://r\n\n<b>i</b> [l](http://y)\n";
        const blocks = parseBlocks(md);
        expect(blocks.map(b => b.kind)).toEqual(["table", "code", "html", "def", "paragraph"]);
        const [table, code, , , paragraph] = blocks;
        expect(table?.kind === "table" ? table.rows.map(r => r.map(c => c.text)) : null).toEqual([["1", "2"]]);
        expect(code?.kind === "code" ? [code.lang, code.text, code.line] : null).toEqual(["mermaid", "x", 5]);
        expect(paragraph?.kind === "paragraph" ? paragraph.inline.map(i => i.kind) : null).toEqual([
            "html",
            "text",
            "html",
            "text",
            "link",
        ]);
    });

    test("reads an ordered list", () => {
        const [list] = parseBlocks("1. one\n2. two\n");
        if (list?.kind !== "list") throw new Error("expected a list");
        expect([list.ordered, list.items.map(i => [i.line, i.text])]).toEqual([
            true,
            [
                [1, "one"],
                [2, "two"],
            ],
        ]);
    });

    test("a thematic break is kind other", () => {
        expect(parseBlocks("a\n\n---\n").map(b => (b.kind === "other" ? b.type : b.kind))).toEqual(["paragraph", "hr"]);
    });

    test("gives a nested list its own blocks and lines; the item inline has only its own text", () => {
        const [list] = parseBlocks("- a `x.ts:1`\n  - b\n  - c\n    more\n  - d\n- e\n");
        if (list?.kind !== "list") throw new Error("expected a list");
        const [first, last] = list.items;
        expect(first?.inline).toEqual([
            { kind: "text", text: "a " },
            { kind: "code", text: "x.ts:1" },
        ]);
        const [nested] = first?.children ?? [];
        if (nested?.kind !== "list") throw new Error("expected a nested list");
        expect([nested.line, nested.items.map(i => i.line)]).toEqual([2, [2, 3, 5]]);
        expect(last?.line).toBe(6);
        expect(last?.children).toEqual([]);
    });

    test("gives a blockquote its nested blocks with file lines", () => {
        const [quote] = parseBlocks("text\n\n> [!NOTE]\n> See:\n> - q `c.ts:3`\n> - r\n").slice(1);
        if (quote?.kind !== "blockquote") throw new Error("expected a blockquote");
        expect(quote.line).toBe(3);
        const [paragraph, list] = quote.children;
        expect(paragraph?.line).toBe(3);
        if (list?.kind !== "list") throw new Error("expected a list");
        expect(list.items.map(i => [i.line, i.inline.map(x => x.text).join("")])).toEqual([
            [5, "q c.ts:3"],
            [6, "r"],
        ]);
    });
});
