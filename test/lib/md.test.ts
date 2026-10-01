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
});
