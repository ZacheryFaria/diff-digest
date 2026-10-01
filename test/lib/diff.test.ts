import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changedFiles, parseDiff, rawDiff, reviewableHunks } from "../../src/lib/diff";
import { EMPTY_TREE, git, rev, type RepoContext } from "../../src/lib/repo";
import type { ChangedFile } from "../../src/lib/schemas";
import { makeRepo, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
afterEach(() => repo?.remove());

function worktree(r: TestRepo, base = rev(r.root, "HEAD")): RepoContext {
    return { root: r.root, base, head: "worktree" };
}

function byPath(files: readonly ChangedFile[], path: string): ChangedFile {
    const file = files.find(f => f.path === path);
    if (file === undefined) throw new Error(`${path} is not in the changed files`);
    return file;
}

describe("parseDiff", () => {
    test("reads hunk ranges and line numbers", () => {
        const text = ["@@ -1,2 +1,3 @@", " a", "-b", "+B", "+c"].join("\n");
        const [hunk] = parseDiff(text);
        expect(hunk).toMatchObject({ start: 1, end: 3, oldStart: 1, oldCount: 2, newStart: 1, newCount: 3, size: 3 });
        expect(hunk?.removed).toEqual([{ n: 2, text: "b" }]);
        expect(hunk?.added).toEqual([
            { n: 2, text: "B" },
            { n: 3, text: "c" },
        ]);
    });

    test("keeps a removed `-- note` line and an added `++ x` line inside a hunk", () => {
        // The removed line's text is "-- note", shown as "--- note" with its "-" marker; the added
        // line's text is "++ x", shown as "+++ x". Both must survive, not be dropped as file headers.
        const text = ["@@ -1,3 +1,3 @@", " a", "--- note", "+++ x", " b"].join("\n");
        const [hunk] = parseDiff(text);
        expect(hunk).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 3 });
        expect(hunk?.removed).toEqual([{ n: 2, text: "-- note" }]);
        expect(hunk?.added).toEqual([{ n: 2, text: "++ x" }]);
    });
});

describe("changedFiles", () => {
    test("includes uncommitted edits and untracked files", () => {
        repo = makeRepo();
        repo.write("a.ts", "export const a = 1;\n");
        repo.commit("init");
        repo.write("a.ts", "export const a = 2;\n");
        repo.write("new.ts", "export const n = 1;\n");
        const ctx = worktree(repo);
        const files = changedFiles(ctx, () => false);
        expect(byPath(files, "a.ts")).toMatchObject({ status: "M", cls: "source", untracked: false });
        const added = byPath(files, "new.ts");
        expect(added).toMatchObject({ status: "A", cls: "source", untracked: true });
        expect(rawDiff(ctx, added)).toContain("+export const n = 1;");
    });

    test("does not throw and does not list a nested untracked git repo", () => {
        repo = makeRepo();
        mkdirSync(join(repo.root, "sub"), { recursive: true });
        git(join(repo.root, "sub"), ["init", "-q", "-b", "main"]);
        writeFileSync(join(repo.root, "sub", "x.ts"), "x\n");
        const files = changedFiles(worktree(repo, EMPTY_TREE), () => false);
        expect(files.some(f => f.path === "sub/" || f.path === "sub")).toBe(false);
    });

    test("does not list files that .gitignore excludes", () => {
        repo = makeRepo();
        repo.write(".gitignore", "dist/\n");
        repo.commit("init");
        repo.write("dist/out.js", "x\n");
        expect(changedFiles(worktree(repo), () => false)).toEqual([]);
    });

    test("works in a repo with no commits", () => {
        repo = makeRepo();
        repo.write("x.ts", "x\n");
        const files = changedFiles({ root: repo.root, base: EMPTY_TREE, head: "worktree" }, () => false);
        expect(files.map(f => f.path)).toEqual(["x.ts"]);
    });

    test("sorts files into classes", () => {
        repo = makeRepo();
        repo.write(".gitattributes", "gen/** linguist-generated\n");
        repo.commit("init");
        repo.write("pnpm-lock.yaml", "lock\n");
        repo.write("gen/api.ts", "x\n");
        repo.write("src/a.test.ts", "x\n");
        repo.write("src/BUILD.bazel", "x\n");
        repo.write("img.bin", [1, 0, 2]);
        const files = changedFiles(worktree(repo), path => path.endsWith("BUILD.bazel"));
        expect(byPath(files, "pnpm-lock.yaml").cls).toBe("generated");
        expect(byPath(files, "gen/api.ts").cls).toBe("generated");
        expect(byPath(files, "src/a.test.ts").cls).toBe("test");
        expect(byPath(files, "src/BUILD.bazel").cls).toBe("generated");
        expect(byPath(files, "img.bin").cls).toBe("binary");
    });

    test("a path with a non-ASCII character is not quoted", () => {
        repo = makeRepo();
        repo.write("café.ts", "export const a = 1;\n");
        repo.commit("init");
        repo.write("café.ts", "export const a = 2;\n");
        repo.write("new-café.ts", "export const b = 1;\n");
        const files = changedFiles(worktree(repo), () => false);
        expect(byPath(files, "café.ts")).toMatchObject({ status: "M" });
        expect(byPath(files, "new-café.ts")).toMatchObject({ status: "A", untracked: true });
    });

    test("a binary file with a non-ASCII name is class binary", () => {
        repo = makeRepo();
        repo.write("café.bin", [1, 0, 2]);
        repo.commit("init");
        repo.write("café.bin", [1, 0, 3]);
        const files = changedFiles(worktree(repo), () => false);
        expect(byPath(files, "café.bin")).toMatchObject({ status: "M", cls: "binary" });
    });

    test("a rename is reported with the old and new path", () => {
        repo = makeRepo();
        repo.write("old.ts", "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
        repo.commit("init");
        git(repo.root, ["mv", "old.ts", "new.ts"]);
        repo.write("new.ts", "export const a = 1;\nexport const b = 20;\nexport const c = 3;\n");
        const ctx = worktree(repo);
        const files = changedFiles(ctx, () => false);
        const renamed = byPath(files, "new.ts");
        expect(renamed).toMatchObject({ status: "R", oldPath: "old.ts", path: "new.ts" });
        expect(rawDiff(ctx, renamed)).toContain("+export const b = 20;");
    });

    test("a pinned head ignores the working tree", () => {
        repo = makeRepo();
        repo.write("a.ts", "1\n");
        const base = repo.commit("init");
        repo.write("a.ts", "2\n");
        const head = repo.commit("change");
        repo.write("a.ts", "3\n");
        repo.write("untracked.ts", "x\n");
        const files = changedFiles({ root: repo.root, base, head }, () => false);
        expect(files.map(f => f.path)).toEqual(["a.ts"]);
        expect(rawDiff({ root: repo.root, base, head }, byPath(files, "a.ts"))).toContain("+2");
    });
});

describe("reviewableHunks", () => {
    test("drops a hunk that only changes imports", () => {
        repo = makeRepo();
        repo.write("a.ts", 'import { x } from "./x";\n\nexport const a = x;\n');
        repo.commit("init");
        repo.write("a.ts", 'import { x, y } from "./x";\n\nexport const a = x;\n');
        const ctx = worktree(repo);
        const [file] = changedFiles(ctx, () => false);
        if (file === undefined) throw new Error("no changed file");
        expect(reviewableHunks(ctx, file)).toEqual([]);
    });

    test("drops hunks whose lines only moved", () => {
        repo = makeRepo();
        repo.write("a.ts", "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
        repo.commit("init");
        repo.write("a.ts", "export const b = 2;\nexport const c = 3;\nexport const a = 1;\n");
        const ctx = worktree(repo);
        const [file] = changedFiles(ctx, () => false);
        if (file === undefined) throw new Error("no changed file");
        expect(reviewableHunks(ctx, file)).toEqual([]);
    });

    test("keeps a hunk that changes behavior", () => {
        repo = makeRepo();
        repo.write("a.ts", "export const a = 1;\n");
        repo.commit("init");
        repo.write("a.ts", "export const a = 2;\n");
        const ctx = worktree(repo);
        const [file] = changedFiles(ctx, () => false);
        if (file === undefined) throw new Error("no changed file");
        expect(reviewableHunks(ctx, file).map(h => [h.start, h.end])).toEqual([[1, 1]]);
    });

    test("keeps a hunk that removes a `-- comment` line", () => {
        repo = makeRepo();
        repo.write("a.ts", "export const a = 1;\n-- comment\nexport const b = 2;\n");
        repo.commit("init");
        repo.write("a.ts", "export const a = 1;\nexport const b = 2;\n");
        const ctx = worktree(repo);
        const [file] = changedFiles(ctx, () => false);
        if (file === undefined) throw new Error("no changed file");
        const hunks = reviewableHunks(ctx, file);
        expect(hunks).not.toEqual([]);
        expect(hunks.flatMap(h => h.removed)).toEqual([{ n: 2, text: "-- comment" }]);
    });
});
