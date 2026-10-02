import { afterEach, describe, expect, test } from "bun:test";
import { EMPTY_TREE, git, repoKeys, resolveBase, slug, tryRev } from "../../src/lib/repo";
import { expectDigestError, makeRepo, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
afterEach(() => repo?.remove());

describe("repo", () => {
    test("a repo with no commits has the empty tree as its base", () => {
        repo = makeRepo();
        expect(tryRev(repo.root, "HEAD")).toBeNull();
        expect(resolveBase(repo.root)).toBe(EMPTY_TREE);
    });

    test("the base is the merge-base with main", () => {
        repo = makeRepo();
        repo.write("a.txt", "a\n");
        const first = repo.commit("first");
        git(repo.root, ["checkout", "-q", "-b", "zf/topic"]);
        repo.write("a.txt", "b\n");
        repo.commit("second");
        expect(resolveBase(repo.root)).toBe(first);
    });

    test("an explicit base that is not a commit is NOT_FOUND", () => {
        repo = makeRepo();
        const { root } = repo;
        expectDigestError(() => resolveBase(root, "no-such-ref"), "NOT_FOUND");
    });

    test("repo keys come from origin when it exists", () => {
        repo = makeRepo();
        expect(repoKeys(repo.root)).toEqual([repo.root.split("/").at(-1) ?? ""]);
        git(repo.root, ["remote", "add", "origin", "git@github.com:octo/widgets.git"]);
        expect(repoKeys(repo.root)).toEqual(["widgets", "github.com/octo/widgets"]);
    });

    test("git in a folder that is gone is NOT_FOUND", () => {
        repo = makeRepo();
        const root = repo.root;
        repo.remove();
        repo = undefined;
        expectDigestError(() => git(root, ["status"]), "NOT_FOUND");
    });

    test("slug replaces characters that are not safe in a file name", () => {
        expect(slug("zf/foo bar")).toBe("zf-foo-bar");
    });
});
