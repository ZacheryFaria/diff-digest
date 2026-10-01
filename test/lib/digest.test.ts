import { describe, expect, test } from "bun:test";
import { anchors, blockId, findFile, toLf } from "../../src/lib/digest";
import type { ChangedFile } from "../../src/lib/schemas";

describe("digest helpers", () => {
    test("anchors reads single lines and ranges", () => {
        expect(anchors("see `src/a.ts:10` and `b.tsx:3-7`, not `plain`")).toEqual([
            { path: "src/a.ts", start: 10, end: 10 },
            { path: "b.tsx", start: 3, end: 7 },
        ]);
    });

    test("toLf changes CRLF and CR line ends to LF", () => {
        expect(toLf("a\r\nb\rc\n")).toBe("a\nb\nc\n");
    });

    test("blockId is stable and depends on the section", () => {
        expect(blockId("Changes", "a")).toBe(blockId("Changes", "a"));
        expect(blockId("Changes", "a")).not.toBe(blockId("Tests", "a"));
    });

    test("findFile matches a path suffix at a folder edge, or the old path", () => {
        const files: ChangedFile[] = [
            { status: "R", oldPath: "old/x.ts", path: "src/lib/x.ts", cls: "source", untracked: false },
        ];
        expect(findFile(files, "lib/x.ts")?.path).toBe("src/lib/x.ts");
        expect(findFile(files, "old/x.ts")?.path).toBe("src/lib/x.ts");
        expect(findFile(files, "b/x.ts")).toBeUndefined();
    });
});
