import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { initWorkingCopy } from "../../src/cli/init";
import { parseDigest } from "../../src/lib/frontmatter";
import type { PrInfo } from "../../src/lib/backends/types";
import { git, mergeBase, rev } from "../../src/lib/repo";
import { resolveTarget, type PrLookup } from "../../src/cli/target";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

function setup(): { root: string; pr: PrInfo } {
    repo = makeRepo();
    repo.write("a.ts", "1\n");
    repo.commit("init");
    git(repo.root, ["remote", "add", "origin", "git@gh.dev:o/r.git"]);
    git(repo.root, ["checkout", "-q", "-b", "zf/pr"]);
    repo.write("a.ts", "2\n");
    const head = repo.commit("pr change");
    git(repo.root, ["checkout", "-q", "main"]);
    const pr: PrInfo = {
        host: "gh.dev",
        owner: "o",
        repo: "r",
        number: 7,
        url: "https://gh.dev/o/r/pull/7",
        title: "T",
        state: "open",
        baseRef: "main",
        baseSha: rev(repo.root, "main"),
        headRef: "zf/pr",
        headSha: head,
    };
    return { root: repo.root, pr };
}

describe("PR targets", () => {
    test("#7 and the PR URL resolve through the lookup; a PR that is not checked out is pinned", () => {
        const { root, pr } = setup();
        const seen: number[] = [];
        const lookup: PrLookup = ref => {
            seen.push(ref.number);
            return pr;
        };
        const target = resolveTarget(root, "#7", lookup);
        expect(target).toMatchObject({
            kind: "pr",
            name: "zf-pr",
            branch: "zf/pr",
            checkedOut: false,
            head: pr.headSha,
            pr,
        });
        expect(target.base).toBe(mergeBase(root, pr.baseSha, pr.headSha));
        expect(resolveTarget(root, "https://gh.dev/o/r/pull/7", lookup).kind).toBe("pr");
        expect(seen).toEqual([7, 7]);
    });

    test("a PR whose branch is checked out uses the working tree", () => {
        const { root, pr } = setup();
        git(root, ["checkout", "-q", "zf/pr"]);
        expect(resolveTarget(root, "7", () => pr)).toMatchObject({ kind: "pr", checkedOut: true });
    });

    test("init for a PR keeps the PR URL in meta.pr", () => {
        const { root, pr } = setup();
        home = tempDir("dd-home-");
        const made = initWorkingCopy("#7", { cwd: root, home, lookupPr: () => pr });
        expect(parseDigest(readFileSync(made.path, "utf8")).frontmatter.meta).toEqual({ pr: pr.url });
    });
});
