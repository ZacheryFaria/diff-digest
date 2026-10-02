import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { realDeps } from "../../src/lib/backends/deps";
import { wrapFrontmatter } from "../../src/lib/backends/envelope";
import { gh } from "../../src/lib/backends/gh";
import { parseDigest } from "../../src/lib/frontmatter";
import { pullDigest, type PullTarget } from "../../src/lib/publish/pull";
import { ShaSchema } from "../../src/lib/schemas";
import { fakeDeps } from "../helpers/backend";
import { expectDigestError, makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

const FAIL = { ok: false, stdout: "", stderr: "gh: connection refused" } as const;
const CONFIG = { backends: { github: { type: "github" }, notes: { type: "local", dir: "/vault" } } };

/** A repo with one commit. With `origin`, the github backend asks gh for the branch's PR. */
function setup(origin = false): { root: string; home: string; head: string } {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "1\n");
    const head = repo.commit("init");
    if (origin) {
        const config = readFileSync(`${repo.root}/.git/config`, "utf8");
        repo.write(".git/config", `${config}[remote "origin"]\n\turl = git@gh.dev:o/r.git\n`);
    }
    writeFileSync(`${home}/config.json`, JSON.stringify(CONFIG));
    return { root: repo.root, home, head };
}

function target(head: string, extra: Partial<PullTarget> = {}): PullTarget {
    return { name: "x", branch: "x", checkedOut: false, head: ShaSchema.parse(head), ...extra };
}

function notes(head: string): Map<string, string> {
    const { files } = fakeDeps();
    const meta = {
        v: 1,
        id: "abcd1234",
        branch: "x",
        base: ShaSchema.parse(head),
        head: ShaSchema.parse(head),
    } as const;
    files.set("/vault/x.md", wrapFrontmatter("\n# Pulled\n", meta, {}));
    return files;
}

describe("pull with failing backends", () => {
    test("a failing gh does not stop the search: the digest comes from notes", async () => {
        const s = setup(true);
        const { deps, files, calls } = fakeDeps(() => FAIL);
        for (const [k, v] of notes(s.head)) files.set(k, v);
        const options = { from: ["github", "notes"], force: false, home: s.home };
        const report = await pullDigest(s.root, target(s.head), options, deps);
        expect(report).toMatchObject({ backend: "notes", stale: false, headMissing: false });
        expect(calls.some(c => c.command === "gh")).toBe(true);
    });

    test("when no backend has the digest, the failures are in the NOT_FOUND hint", async () => {
        const s = setup(true);
        const { deps } = fakeDeps(() => FAIL);
        const options = { from: ["github", "notes"], force: false, home: s.home };
        const failure: unknown = await pullDigest(s.root, target(s.head), options, deps).catch((e: unknown) => e);
        expect(failure).toMatchObject({ code: "NOT_FOUND" });
        expect(JSON.stringify(failure)).toContain("github failed");
    });

    test("gh that is not installed is BACKEND_FAILED, not INTERNAL", () => {
        const call = { host: "gh.dev", cwd: ".", args: ["api", "x"] };
        expect(realDeps.exec("dd-no-such-command-xyz", [], { cwd: "." }).ok).toBe(false);
        const exec = realDeps.exec;
        const missing = {
            ...realDeps,
            exec: (_c: string, args: readonly string[], options: Parameters<typeof exec>[2]) =>
                exec("dd-no-such-command-xyz", args, options),
        };
        expectDigestError(() => gh(missing, call), "BACKEND_FAILED");
    });
});

describe("pull for a pinned target", () => {
    test("a digest head that is not in the clone pins the copy to the target head", async () => {
        const s = setup();
        const { deps, files } = fakeDeps();
        const meta = {
            v: 1,
            id: "abcd1234",
            branch: "x",
            base: ShaSchema.parse(s.head),
            head: ShaSchema.parse("c".repeat(40)),
        } as const;
        files.set("/vault/x.md", wrapFrontmatter("\n# Pulled\n", meta, {}));
        const report = await pullDigest(s.root, target(s.head), { from: ["notes"], force: false, home: s.home }, deps);
        expect(report).toMatchObject({ stale: true, headMissing: true });
        expect(parseDigest(readFileSync(report.path, "utf8")).frontmatter).toMatchObject({
            head: s.head,
            pinned: true,
        });
    });

    test("a copy pulled for a PR target keeps the PR URL in meta.pr", async () => {
        const s = setup();
        const { deps, files } = fakeDeps();
        for (const [k, v] of notes(s.head)) files.set(k, v);
        const pr = {
            host: "gh.dev",
            owner: "o",
            repo: "r",
            number: 9,
            url: "https://gh.dev/o/r/pull/9",
            title: "T",
            state: "open",
            baseRef: "main",
            headRef: "x",
            baseSha: ShaSchema.parse(s.head),
            headSha: ShaSchema.parse(s.head),
        };
        const report = await pullDigest(
            s.root,
            target(s.head, { pr }),
            { from: ["notes"], force: false, home: s.home },
            deps,
        );
        expect(parseDigest(readFileSync(report.path, "utf8")).frontmatter.meta).toEqual({ pr: pr.url });
    });
});
