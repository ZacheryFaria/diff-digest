import { describe, expect, test } from "bun:test";
import { diffView, fileView, type CodeLine, type ViewRow } from "../../src/app/code/rows";
import { codeThreads, dragTo, focusKey, rangeRows, rangeTarget } from "../../src/app/code/select";
import type { Comment } from "../../src/lib/schemas";
import type { FilePayload } from "../../src/lib/schemas-api";

const DIFF = {
    path: "a.ts",
    oldPath: "a.ts",
    unchanged: false,
    text: ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,2 @@", " one", "-two", "+TWO"].join(
        "\n",
    ),
};

function code(rows: readonly ViewRow[]): readonly CodeLine[] {
    return rows.filter(r => r.kind === "code");
}

function comment(target: Comment["target"]): Comment {
    return { id: "c1", created: "2026-10-01T00:00:00.000Z", author: "user", status: "open", target, body: "b" };
}

describe("diffView", () => {
    test("gives each side its own line and focuses the anchored hunk", () => {
        const rows = diffView(DIFF, { start: 2, end: 2 });
        expect(rows[0]).toMatchObject({ kind: "hunk" });
        expect(code(rows).map(r => [r.rev, r.line, r.classes])).toEqual([
            ["head", 1, ["hunk-focus", "hunk-top"]],
            ["base", 2, ["removed", "hunk-focus"]],
            ["head", 2, ["added", "hunk-focus", "hunk-bottom"]],
        ]);
    });

    test("focuses nothing with no anchor", () => {
        expect(code(diffView(DIFF, {})).flatMap(r => r.classes)).toEqual(["removed", "added"]);
    });
});

describe("fileView", () => {
    const file: FilePayload = {
        path: "a.ts",
        oldPath: "a.ts",
        rev: "head",
        text: "one\nTWO\n",
        marks: { "2": "changed" },
        hunks: [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 2, added: [2], removed: [{ n: 2, text: "two" }] }],
        unchanged: false,
    };

    test("shows the removed lines of an anchored hunk above their replacement", () => {
        const rows = code(fileView(file, { start: 2, end: 2 }));
        expect(rows.map(r => [r.rev, r.line, r.text])).toEqual([
            ["head", 1, "one"],
            ["base", 2, "two"],
            ["head", 2, "TWO"],
        ]);
        expect(rows[2]?.classes).toEqual(["changed", "anchor-range", "hunk-focus", "hunk-bottom"]);
    });

    test("shows only the file with no anchor", () => {
        expect(code(fileView(file, {})).map(r => r.text)).toEqual(["one", "TWO"]);
    });
});

describe("range selection", () => {
    const rows = diffView(DIFF, {});
    const [one, two, TWO] = code(rows);

    test("keeps to the side where the drag started", () => {
        if (one === undefined || TWO === undefined || two === undefined) throw new Error("rows");
        expect(rangeRows(rows, TWO, one).map(r => r.line)).toEqual([1, 2]);
        expect(rangeRows(rows, two, one)).toEqual([two]);
        expect(rangeTarget(rangeRows(rows, one, TWO))).toEqual({
            kind: "code",
            path: "a.ts",
            rev: "head",
            line: 1,
            endLine: 2,
            text: "one\nTWO",
        });
    });

    test("keeps the range when the drag passes over and ends on a removed row", () => {
        if (one === undefined || TWO === undefined || two === undefined) throw new Error("rows");
        let to = dragTo(one, one, TWO);
        to = dragTo(one, to, two);
        expect(to).toBe(TWO);
        expect(rangeRows(rows, one, to).map(r => [r.rev, r.line])).toEqual([
            ["head", 1],
            ["head", 2],
        ]);
    });

    test("puts a range comment under its last row", () => {
        const c = comment({ kind: "code", path: "a.ts", rev: "head", line: 1, endLine: 2, text: "" });
        const threads = codeThreads(rows, [c]);
        expect([...threads.byRow.keys()]).toEqual([TWO?.key ?? ""]);
        expect(threads.ranged.size).toBe(2);
    });
});

describe("focusKey", () => {
    test("scrolls to the anchored hunk first, else to the first change", () => {
        const anchored = diffView(DIFF, { start: 2, end: 2 });
        expect(focusKey(anchored)).toBe(code(anchored)[0]?.key);
        const plain = diffView(DIFF, {});
        expect(focusKey(plain)).toBe(code(plain).find(r => r.classes.includes("added"))?.key);
        expect(focusKey([])).toBeUndefined();
    });
});
