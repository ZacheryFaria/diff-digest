import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { coverageGaps } from "../../src/lib/coverage";
import { changedFiles } from "../../src/lib/diff";
import { rev, type RepoContext } from "../../src/lib/repo";
import { makeRepo, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
afterEach(() => repo?.remove());

function setup(): RepoContext {
    repo = makeRepo();
    repo.write("src/a.ts", "export const a = 1;\nexport const b = 2;\n");
    repo.write("src/gone.ts", "x\n");
    repo.commit("init");
    repo.write("src/a.ts", "export const a = 1;\nexport const b = 3;\n");
    repo.write("src/gone.ts", "");
    return { root: repo.root, base: rev(repo.root, "HEAD"), head: "worktree" };
}

describe("coverageGaps", () => {
    test("reports a hunk that no anchor touches", () => {
        const ctx = setup();
        expect(
            coverageGaps(
                ctx,
                "# Title\n",
                changedFiles(ctx, () => false),
            ),
        ).toEqual(["src/a.ts:2-2", "src/gone.ts:1-1"]);
    });

    test("an anchor on a path suffix next to the hunk covers it", () => {
        const ctx = setup();
        const md = "- b changed: `a.ts:1`\n- gone emptied: `gone.ts:1`\n";
        expect(
            coverageGaps(
                ctx,
                md,
                changedFiles(ctx, () => false),
            ),
        ).toEqual([]);
    });

    test("a deleted file is a gap unless the digest names it", () => {
        repo = makeRepo();
        repo.write("src/old.ts", "x\n");
        repo.commit("init");
        rmSync(join(repo.root, "src/old.ts"));
        const ctx: RepoContext = { root: repo.root, base: rev(repo.root, "HEAD"), head: "worktree" };
        const files = changedFiles(ctx, () => false);
        expect(coverageGaps(ctx, "# Title\n", files)).toEqual(["src/old.ts (deleted)"]);
        expect(coverageGaps(ctx, "- removed `old.ts`\n", files)).toEqual([]);
    });
});
