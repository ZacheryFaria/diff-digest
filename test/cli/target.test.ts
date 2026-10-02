import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { z } from "zod";
import { parseDigest } from "../../src/lib/frontmatter";
import { git } from "../../src/lib/repo";
import { resolveDigest } from "../../src/cli/ref";
import { registerDigest, registryPath } from "../../src/lib/registry";
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

    test("lint for a target with no working copy is NOT_FOUND (exit 4) with a hint", () => {
        const r = setup();
        const result = runCli(["lint", "main", "--json"], r.root, home ?? "");
        expect(result.code).toBe(4);
        expect(envelope(result)).toMatchObject({
            ok: false,
            error: { code: "NOT_FOUND", hint: "Create it with `diff-digest init`." },
        });
    });

    test("hunks and init take --base; init writes head null for the working tree and the sha when pinned", () => {
        const r = setup();
        const h = home ?? "";
        const parent = git(r.root, ["rev-parse", "zf/topic"]).trim();
        git(r.root, ["checkout", "-q", "-b", "zf/child"]);
        r.write("b.ts", "b\n");
        r.commit("child");
        r.write("b.ts", "b2\n");
        expect(envelope(runCli(["hunks", "--base", "zf/topic", "--json"], r.root, h))).toMatchObject({
            ok: true,
            data: { base: parent, head: "worktree", files: [{ path: "b.ts" }] },
        });
        const init = envelope(runCli(["init", "--base", "zf/topic", "--json"], r.root, h));
        if (!init.ok) throw new Error(JSON.stringify(init));
        const { path } = z.object({ path: z.string() }).parse(init.data);
        expect(parseDigest(readFileSync(path, "utf8")).frontmatter).toMatchObject({ base: parent, head: null });
        const pinned = envelope(runCli(["init", "zf/topic", "--json"], r.root, h));
        if (!pinned.ok) throw new Error(JSON.stringify(pinned));
        const pinnedPath = z.object({ path: z.string() }).parse(pinned.data).path;
        expect(parseDigest(readFileSync(pinnedPath, "utf8")).frontmatter).toMatchObject({
            head: parent,
            pinned: true,
        });
    });

    test("hunks lists the changed files and the reviewable hunks", () => {
        const r = setup();
        expect(envelope(runCli(["hunks", "--json"], r.root, home ?? ""))).toMatchObject({
            ok: true,
            data: { files: [{ path: "a.ts", cls: "source", hunks: [{ start: 1, end: 1 }] }], reviewableLines: 2 },
        });
        expect(runCli(["hunks"], r.root, home ?? "").stdout).toContain("source    M a.ts");
    });

    test("a target ref replaces a stale root in the registry", () => {
        const r = setup();
        const h = home ?? "";
        runCli(["init"], r.root, h);
        const entry = resolveDigest({}, { cwd: r.root, home: h });
        registerDigest({ ...entry, root: "/gone" }, registryPath(h));
        expect(resolveDigest({}, { cwd: r.root, home: h }).root).toBe(r.root);
    });
});
