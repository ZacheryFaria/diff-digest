import { describe, expect, test } from "bun:test";
import { diffRows } from "../../src/app/code/diff";
import { richInline } from "../../src/app/markdown/rich-inline";
import { buildTree } from "../../src/app/tree";
import type { MarkedFile } from "../../src/lib/schemas-api";

describe("richInline", () => {
    test("keeps bold, code, links, and images as nodes", () => {
        expect(richInline("a **b `c`** [d](https://e) ![f](g.png)")).toEqual([
            { kind: "text", text: "a " },
            {
                kind: "strong",
                children: [
                    { kind: "text", text: "b " },
                    { kind: "code", text: "c" },
                ],
            },
            { kind: "text", text: " " },
            { kind: "link", href: "https://e", children: [{ kind: "text", text: "d" }] },
            { kind: "text", text: " " },
            { kind: "image", href: "g.png", alt: "f" },
        ]);
    });
});

describe("diffRows", () => {
    test("numbers the old and new lines and skips file headers", () => {
        const text = [
            "diff --git a/x b/x",
            "--- a/x",
            "+++ b/x",
            "@@ -1,2 +1,2 @@",
            " a",
            "-b",
            "+B",
            "\\ No newline at end of file",
        ].join("\n");
        expect(diffRows(text)).toEqual([
            { kind: "hunk", text: "@@ -1,2 +1,2 @@", newStart: 1, newEnd: 2 },
            { kind: "line", sign: " ", oldN: 1, newN: 1, text: "a" },
            { kind: "line", sign: "-", oldN: 2, newN: null, text: "b" },
            { kind: "line", sign: "+", oldN: null, newN: 2, text: "B" },
        ]);
    });
});

function file(path: string): MarkedFile {
    return { status: "M", path, oldPath: path, cls: "source", untracked: false, marked: false };
}

describe("buildTree", () => {
    test("groups by folder, joins single-child folders, and sorts", () => {
        const tree = buildTree([
            file("src/deep/er/z.ts"),
            file("src/deep/er/a.ts"),
            file("b.ts"),
            file("lib/x.ts"),
            file("lib/y/z.ts"),
        ]);
        expect(tree.files.map(f => f.name)).toEqual(["b.ts"]);
        expect(tree.dirs.map(d => d.label)).toEqual(["lib", "src/deep/er"]);
        expect(tree.dirs[1]?.files.map(f => f.name)).toEqual(["a.ts", "z.ts"]);
        expect(tree.dirs[0]?.dirs.map(d => d.label)).toEqual(["y"]);
    });
});
