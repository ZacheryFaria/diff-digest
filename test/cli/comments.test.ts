import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { updateComments } from "../../src/lib/store";
import { envelope, runCli } from "../helpers/cli";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

function setup(): { cwd: string; home: string; mdPath: string } {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "1\n");
    repo.commit("init");
    repo.write("a.ts", "2\n");
    runCli(["init"], repo.root, home);
    const mdPath = runCli(["path"], repo.root, home).stdout.trim();
    writeFileSync(
        mdPath,
        readFileSync(mdPath, "utf8").replace("\n# Title\n", "\n# Two\n\n## Changes\n\n- a is two: `a.ts:1`\n"),
    );
    updateComments(mdPath, () => [
        {
            id: "c1",
            created: "2026-10-01T00:00:00.000Z",
            author: "user",
            status: "open",
            target: { kind: "code", path: "a.ts", rev: "head", line: 1, text: "2" },
            body: "Why two?",
        },
    ]);
    return { cwd: repo.root, home, mdPath };
}

describe("comment commands", () => {
    test("comments lists open comments; --markdown gives the review comment", () => {
        const s = setup();
        expect(envelope(runCli(["comments", "--json"], s.cwd, s.home))).toMatchObject({
            ok: true,
            data: [{ id: "c1" }],
        });
        expect(runCli(["comments", "--markdown"], s.cwd, s.home).stdout).toContain("- `a.ts:1` (after) — `2`");
    });

    test("resolve, note, and the status filter", () => {
        const s = setup();
        expect(runCli(["resolve", "c1", "Because."], s.cwd, s.home).stdout).toBe("resolved c1\n");
        expect(envelope(runCli(["comments", "--json"], s.cwd, s.home))).toMatchObject({ ok: true, data: [] });
        expect(runCli(["note", "a is two", "Checked."], s.cwd, s.home).code).toBe(0);
        const all = envelope(runCli(["comments", "--status", "resolved,note", "--json"], s.cwd, s.home));
        expect(all).toMatchObject({
            ok: true,
            data: [
                { status: "resolved", reply: "Because." },
                { author: "agent", status: "note" },
            ],
        });
        const missing = runCli(["resolve", "nope", "x", "--json"], s.cwd, s.home);
        expect(missing.code).toBe(4);
    });

    test("comments --status rejects a value that is not a status (BAD_INPUT, exit 3)", () => {
        const s = setup();
        const result = runCli(["comments", "--status", "open,bogus", "--json"], s.cwd, s.home);
        expect(envelope(result)).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
        expect(result.code).toBe(3);
    });

    test("mark writes the repo's generated list", () => {
        const s = setup();
        expect(runCli(["mark", "a.ts"], s.cwd, s.home).stdout).toBe("marked a.ts\n");
        expect(readFileSync(join(s.home, "config.json"), "utf8")).toContain(String.raw`"^a\\.ts$"`);
        expect(envelope(runCli(["hunks", "--json"], s.cwd, s.home))).toMatchObject({
            ok: true,
            data: { files: [{ cls: "generated" }] },
        });
        runCli(["mark", "a.ts", "--off"], s.cwd, s.home);
        expect(envelope(runCli(["hunks", "--json"], s.cwd, s.home))).toMatchObject({
            ok: true,
            data: { files: [{ cls: "source" }] },
        });
    });
});
