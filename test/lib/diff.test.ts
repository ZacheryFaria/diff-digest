import { afterEach, describe, expect, test } from "bun:test";
import { changedFiles, parseDiff, rawDiff, reviewableHunks } from "../../src/lib/diff";
import { EMPTY_TREE, rev, type RepoContext } from "../../src/lib/repo";
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
});
