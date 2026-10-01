import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { git } from "../../src/lib/repo";
import { resolveDigest } from "../../src/cli/ref";
import { resolveTarget } from "../../src/cli/target";
import { envelope, runCli } from "../helpers/cli";
import { expectDigestError, makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

function setup(): TestRepo {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "1\n");
    repo.commit("init");
    git(repo.root, ["checkout", "-q", "-b", "zf/topic"]);
    repo.write("a.ts", "2\n");
    repo.commit("change");
    return repo;
}

describe("resolveTarget", () => {
    test("the current branch, another branch, a commit, and a range", () => {
        const r = setup();
        const main = git(r.root, ["rev-parse", "main"]).trim();
        expect(resolveTarget(r.root)).toMatchObject({
            kind: "branch",
            name: "zf-topic",
            branch: "zf/topic",
            checkedOut: true,
            base: main,
        });
        expect(resolveTarget(r.root, "main")).toMatchObject({ kind: "branch", checkedOut: false });
        expect(resolveTarget(r.root, "HEAD")).toMatchObject({ kind: "commit", base: main });
        expect(resolveTarget(r.root, "main..zf/topic")).toMatchObject({ kind: "range", base: main });
        expectDigestError(() => resolveTarget(r.root, "#12"), "BAD_INPUT");
        expectDigestError(() => resolveTarget(r.root, "nope"), "NOT_FOUND");
    });

    test("a repo with no commits has the empty tree as its base and no head", () => {
        repo = makeRepo();
        expect(resolveTarget(repo.root)).toMatchObject({ name: "main", head: null, checkedOut: true });
    });
});

describe("init, path, and the digest reference", () => {
    test("init creates the working copy once, and the reference finds it", () => {
        const r = setup();
        const h = home ?? "";
        const first = envelope(runCli(["init", "--json"], r.root, h));
        expect(first).toMatchObject({ ok: true, data: { created: true } });
        const second = envelope(runCli(["init", "--json"], r.root, h));
        expect(second).toMatchObject({ ok: true, data: { created: false } });
        if (!first.ok) throw new Error("init failed");
        const data = first.data;
        if (typeof data !== "object" || data === null || !("path" in data) || typeof data.path !== "string")
            throw new Error("no path");
        expect(readFileSync(data.path, "utf8")).toContain("pinned: false");
        expect(runCli(["path"], r.root, h).stdout.trim()).toBe(data.path);
        const entry = resolveDigest({}, { cwd: r.root, home: h });
        expect(entry.mdPath).toBe(data.path);
        expect(resolveDigest({ id: entry.id }, { cwd: r.root, home: h }).mdPath).toBe(data.path);
        expect(resolveDigest({ ref: data.path }, { cwd: r.root, home: h }).id).toBe(entry.id);
    });

    test("a target with no working copy is NOT_FOUND with a hint", () => {
        const r = setup();
        const result = runCli(["hunks", "--json"], r.root, home ?? "");
        expect(result.code).toBe(0);
        expectDigestError(() => resolveDigest({ ref: "main" }, { cwd: r.root, home: home ?? "" }), "NOT_FOUND");
    });

    test("hunks lists the changed files and the reviewable hunks", () => {
        const r = setup();
        expect(envelope(runCli(["hunks", "--json"], r.root, home ?? ""))).toMatchObject({
            ok: true,
            data: { files: [{ path: "a.ts", cls: "source", hunks: [{ start: 1, end: 1 }] }], reviewableLines: 2 },
        });
        expect(runCli(["hunks"], r.root, home ?? "").stdout).toContain("source    M a.ts");
    });
});
