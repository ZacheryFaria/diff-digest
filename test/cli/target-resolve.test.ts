import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { resolveTarget } from "../../src/cli/target";
import { EMPTY_TREE, git, mergeBase, rev } from "../../src/lib/repo";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let extra: string | undefined;
afterEach(() => {
    repo?.remove();
    if (extra !== undefined) rmSync(extra, { recursive: true, force: true });
    extra = undefined;
});

function base(): TestRepo {
    repo = makeRepo();
    repo.write("a.ts", "1\n");
    repo.commit("init");
    return repo;
}

/** Makes commits until the short sha starts with a digit and has a letter (so it is not a PR number). */
function digitFirstSha(r: TestRepo): string {
    for (let i = 0; i < 200; i += 1) {
        r.write("a.ts", `${i}\n`);
        const sha = r.commit(`c${i}`).slice(0, 7);
        if (/^\d/u.test(sha) && /[a-f]/u.test(sha)) return sha;
    }
    throw new Error("No digit-first sha in 200 commits.");
}

describe("resolveTarget: refs that look like PR numbers", () => {
    test("a digit-first short sha is a commit", () => {
        const r = base();
        const sha = digitFirstSha(r);
        expect(resolveTarget(r.root, sha)).toMatchObject({ kind: "commit", head: rev(r.root, sha) });
    });

    test("a digit-first branch name is a branch", () => {
        const r = base();
        git(r.root, ["branch", "123-fix"]);
        expect(resolveTarget(r.root, "123-fix")).toMatchObject({ kind: "branch", branch: "123-fix" });
    });
});

describe("resolveTarget: branches, ranges, and special commits", () => {
    test("a branch that exists only on origin, with and without `origin/`", () => {
        const r = base();
        extra = tempDir("dd-origin-");
        git(extra, ["init", "-q", "--bare"]);
        git(r.root, ["remote", "add", "origin", join(extra)]);
        git(r.root, ["push", "-q", "origin", "main"]);
        git(r.root, ["checkout", "-q", "-b", "feat"]);
        r.write("b.ts", "b\n");
        const head = r.commit("feat");
        git(r.root, ["push", "-q", "origin", "feat"]);
        git(r.root, ["checkout", "-q", "main"]);
        git(r.root, ["branch", "-q", "-D", "feat"]);
        for (const arg of ["feat", "origin/feat"]) {
            expect(resolveTarget(r.root, arg)).toMatchObject({
                kind: "branch",
                name: "feat",
                branch: "feat",
                checkedOut: false,
                head,
            });
        }
    });

    test("a...b uses the merge-base as its base; a..b uses a", () => {
        const r = base();
        git(r.root, ["checkout", "-q", "-b", "topic"]);
        r.write("b.ts", "b\n");
        r.commit("topic");
        git(r.root, ["checkout", "-q", "main"]);
        r.write("c.ts", "c\n");
        const main = r.commit("main moves");
        const fork = mergeBase(r.root, "main", "topic");
        expect(resolveTarget(r.root, "main...topic")).toMatchObject({ kind: "range", base: fork });
        expect(resolveTarget(r.root, "main..topic")).toMatchObject({ kind: "range", base: main });
    });

    test("a root commit has the empty tree as its base", () => {
        const r = base();
        const root = rev(r.root, "HEAD");
        r.write("a.ts", "2\n");
        r.commit("second");
        expect(resolveTarget(r.root, root)).toMatchObject({ kind: "commit", base: EMPTY_TREE, head: root });
    });

    test("a detached HEAD is the working tree, named for its commit", () => {
        const r = base();
        r.write("a.ts", "2\n");
        const head = r.commit("second");
        git(r.root, ["checkout", "-q", "--detach"]);
        expect(resolveTarget(r.root)).toMatchObject({
            kind: "branch",
            name: `commit-${head.slice(0, 11)}`,
            checkedOut: true,
            head,
        });
    });
});
