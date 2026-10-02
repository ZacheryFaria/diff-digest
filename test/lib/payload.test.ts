import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { anchorChecker, checkDigest } from "../../src/lib/check";
import { setGenerated } from "../../src/lib/config";
import { diffPayload, filePayload } from "../../src/lib/files";
import { digestPayload, openDigest } from "../../src/lib/payload";
import { makeDigest } from "../helpers/digest";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

function setup(body = "# T\n\n- `a.ts:2`\n"): ReturnType<typeof openDigest> {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "one\ntwo\nthree\n");
    repo.write("keep.ts", "k\n");
    repo.write("gone.ts", "g\n");
    repo.commit("init");
    repo.write("a.ts", "one\nTWO\nthree\n");
    repo.write("new.ts", "n\n");
    rmSync(join(repo.root, "gone.ts"));
    return openDigest(makeDigest(repo, home, body), home);
}

describe("digestPayload", () => {
    test("lists the changed files with stats, and marks files the user marked generated", () => {
        const open = setup();
        if (home === undefined || repo === undefined) throw new Error("no setup");
        setGenerated("new.ts", true, [repo.root.split("/").at(-1) ?? ""], join(home, "config.json"));
        const payload = digestPayload(openDigest(open.entry, home));
        expect(payload.files.map(f => [f.path, f.status, f.cls, f.marked])).toEqual([
            ["a.ts", "M", "source", false],
            ["gone.ts", "D", "source", false],
            ["new.ts", "A", "generated", true],
        ]);
        expect(payload.stats).toEqual({ files: 3, generated: 1, diffLines: 3, digestLines: 2 });
        expect(payload.head).toBe(open.frontmatter.base);
    });
});

describe("file views", () => {
    test("diffPayload gives the diff, or unchanged for a file with no diff", () => {
        const open = setup();
        expect(diffPayload(open.ctx, open.files, "a.ts")).toMatchObject({ path: "a.ts", unchanged: false });
        expect(diffPayload(open.ctx, open.files, "a.ts").text).toContain("+TWO");
        expect(diffPayload(open.ctx, open.files, "keep.ts")).toEqual({
            path: "keep.ts",
            oldPath: "keep.ts",
            text: "",
            unchanged: true,
        });
    });

    test("filePayload marks changed lines on each side and explains missing sides", () => {
        const open = setup();
        const head = filePayload(open.ctx, open.files, "a.ts", "head");
        expect(head).toMatchObject({ text: "one\nTWO\nthree\n", marks: { "2": "changed" }, unchanged: false });
        expect(filePayload(open.ctx, open.files, "a.ts", "base")).toMatchObject({
            text: "one\ntwo\nthree\n",
            marks: { "2": "removed" },
        });
        expect(filePayload(open.ctx, open.files, "new.ts", "base").error).toBe("Added in this change");
        expect(filePayload(open.ctx, open.files, "gone.ts", "head").error).toBe("Deleted in this change");
        expect(filePayload(open.ctx, open.files, "keep.ts", "head")).toMatchObject({ text: "k\n", unchanged: true });
        expect(filePayload(open.ctx, open.files, "nope.ts", "head").error).toBe("No file matches nope.ts");
    });
});

describe("check", () => {
    test("anchorChecker accepts a real range and explains each bad anchor", () => {
        const check = anchorChecker(setup());
        expect(check({ path: "a.ts", start: 2, end: 3 })).toBeNull();
        expect(check({ path: "keep.ts", start: 1, end: 1 })).toBeNull();
        expect(check({ path: "a.ts", start: 2, end: 9 })).toBe("`a.ts:2-9`: a.ts has only 3 lines.");
        expect(check({ path: "nope.ts", start: 1, end: 1 })).toBe("`nope.ts:1`: no single file matches this path.");
        expect(check({ path: "gone.ts", start: 1, end: 1 })).toBe("`gone.ts:1`: gone.ts is deleted in this change.");
    });

    test("checkDigest gives lint issues and coverage gaps", () => {
        const result = checkDigest(setup("# T\n\n- `a.ts:9`\n"));
        expect(result.issues.filter(i => i.severity === "error").map(i => i.rule)).toEqual(["anchor-resolves"]);
        expect(result.gaps).toEqual(["a.ts:2-2", "gone.ts (deleted)", "new.ts:1-1"]);
    });
});
