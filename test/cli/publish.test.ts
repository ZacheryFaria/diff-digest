import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readComments, updateComments } from "../../src/lib/store";
import { envelope, runCli } from "../helpers/cli";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
let vault: string | undefined;
afterEach(() => {
    repo?.remove();
    for (const d of [home, vault]) if (d !== undefined) rmSync(d, { recursive: true, force: true });
});

const GOOD = "\n# Two\n\n## Changes\n\n- The line is two: `a.ts:1`\n";

function setup(body = GOOD): { cwd: string; home: string; mdPath: string; vault: string } {
    repo = makeRepo();
    home = tempDir("dd-home-");
    vault = tempDir("dd-vault-");
    repo.write("a.ts", "1\n");
    repo.commit("init");
    repo.write("a.ts", "2\n");
    const config = {
        backends: {
            notes: { type: "local", dir: `${vault}/{repo}`, linkTemplate: "vscode://file/{root}/{path}:{start}" },
        },
        publishTo: ["notes"],
    };
    writeFileSync(join(home, "config.json"), JSON.stringify(config));
    runCli(["init"], repo.root, home);
    const mdPath = runCli(["path"], repo.root, home).stdout.trim();
    writeFileSync(mdPath, readFileSync(mdPath, "utf8").replace("\n# Title\n", body));
    return { cwd: repo.root, home, mdPath, vault };
}

describe("publish, comments --publish, pull (local backend)", () => {
    test("publish writes the digest with links and frontmatter; a dry run writes nothing", () => {
        const s = setup();
        const dry = envelope(runCli(["publish", "--dry-run", "--json"], s.cwd, s.home));
        expect(dry).toMatchObject({ ok: true, data: { results: [], previews: [{ backend: "notes" }] } });
        const published = envelope(runCli(["publish", "--json"], s.cwd, s.home));
        expect(published).toMatchObject({ ok: true, data: { results: [{ backend: "notes", updated: false }] } });
        const repoName = s.cwd.split("/").at(-1) ?? "";
        const file = join(s.vault, repoName, "main.md");
        const text = readFileSync(file, "utf8");
        expect(text).toContain("diff-digest:");
        expect(text).toContain(`[\`a.ts:1\`](vscode://file/${s.cwd}/a.ts:1)`);
        expect(envelope(runCli(["publish", "--json"], s.cwd, s.home))).toMatchObject({
            ok: true,
            data: { results: [{ updated: true }] },
        });
    });

    test("publish refuses lint errors (exit 5) unless --force", () => {
        const s = setup("\n# Two\n\n- see `a.ts:9`\n");
        const refused = runCli(["publish", "--json"], s.cwd, s.home);
        expect(refused.code).toBe(5);
        expect(envelope(refused)).toMatchObject({ ok: false, error: { code: "LINT_FAILED" } });
        expect(runCli(["publish", "--force"], s.cwd, s.home).code).toBe(0);
    });

    test("comments --publish writes the review and marks the comments shared", () => {
        const s = setup();
        updateComments(s.mdPath, () => [
            {
                id: "c1",
                created: "2026-10-01T00:00:00.000Z",
                author: "user",
                status: "open",
                target: { kind: "code", path: "a.ts", rev: "head", line: 1, text: "2" },
                body: "Why two?",
            },
        ]);
        const result = envelope(runCli(["comments", "--publish", "--json"], s.cwd, s.home));
        expect(result).toMatchObject({ ok: true, data: { results: [{ backend: "notes" }] } });
        const repoName = s.cwd.split("/").at(-1) ?? "";
        expect(readFileSync(join(s.vault, repoName, "main.review.md"), "utf8")).toContain("Why two?");
        expect(readComments(s.mdPath)).toMatchObject([
            { status: "shared", ref: join(s.vault, repoName, "main.review.md") },
        ]);
    });

    test("pull writes the working copy from the backend, and refuses to replace one without --force", () => {
        const s = setup();
        runCli(["publish"], s.cwd, s.home);
        expect(runCli(["pull", "--json"], s.cwd, s.home).code).toBe(3);
        rmSync(s.mdPath);
        const pulled = envelope(runCli(["pull", "--json"], s.cwd, s.home));
        expect(pulled).toMatchObject({ ok: true, data: { path: s.mdPath, backend: "notes", stale: false } });
        expect(existsSync(s.mdPath)).toBe(true);
        const md = readFileSync(s.mdPath, "utf8");
        expect(md).toContain("- The line is two: `a.ts:1`");
        expect(md).not.toContain("vscode://");
        expect(runCli(["check"], s.cwd, s.home).code).toBe(0);
    });
});
