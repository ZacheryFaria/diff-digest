import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Comment } from "../../src/lib/schemas";
import { commentsPath, readComments, updateComments, workingCopyPath, writeComments } from "../../src/lib/store";
import { expectDigestError, tempDir } from "../helpers/repo";

let dir: string | undefined;
afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

const TARGET = { kind: "code", path: "src/a.ts", rev: "head", line: 3, endLine: 5, text: "x" } as const;

const COMMENT: Comment = {
    id: "c1",
    created: "2026-09-30T12:00:00.000Z",
    author: "user",
    status: "open",
    target: TARGET,
    body: "Why?",
};

describe("store", () => {
    test("the working copy is under store/<repo>", () => {
        expect(workingCopyPath("lca", "zf-foo", "/h")).toBe("/h/store/lca/zf-foo.md");
        expect(commentsPath("/h/store/lca/zf-foo.md")).toBe("/h/store/lca/zf-foo.comments.json");
    });

    test("the working copy rejects names that leave the store", () => {
        for (const bad of ["", ".", "..", "a/b", "a\\b"]) {
            expectDigestError(() => workingCopyPath(bad, "x", "/h"), "BAD_INPUT");
            expectDigestError(() => workingCopyPath("lca", bad, "/h"), "BAD_INPUT");
        }
    });

    test("updateComments changes the file under the lock", () => {
        dir = tempDir("dd-store-");
        const md = join(dir, "d.md");
        updateComments(md, c => [...c, COMMENT]);
        updateComments(md, c => [...c, { ...COMMENT, id: "c2" }]);
        expect(readComments(md).map(c => c.id)).toEqual(["c1", "c2"]);
        expect(readdirSync(dir)).toEqual(["d.comments.json"]);
    });

    test("comments round trip, and the write leaves no temp file", () => {
        dir = tempDir("dd-store-");
        const md = join(dir, "d.md");
        expect(readComments(md)).toEqual([]);
        writeComments(md, [COMMENT]);
        expect(readComments(md)).toEqual([COMMENT]);
        expect(readdirSync(dir)).toEqual(["d.comments.json"]);
    });

    test("a comments file that does not match the schema is BAD_INPUT", () => {
        dir = tempDir("dd-store-");
        const md = join(dir, "d.md");
        writeFileSync(commentsPath(md), JSON.stringify([{ ...COMMENT, status: "posted" }]));
        expectDigestError(() => readComments(md), "BAD_INPUT");
    });

    test("a code range that ends before it starts is rejected", () => {
        dir = tempDir("dd-store-");
        const md = join(dir, "d.md");
        const bad: Comment = { ...COMMENT, target: { ...TARGET, line: 5, endLine: 3 } };
        expect(() => {
            writeComments(md, [bad]);
        }).toThrow();
    });
});
