import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { readComments } from "../../src/lib/store";
import { envelope, runCli } from "../helpers/cli";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

/** A repo with one uncommitted change and an initialized working copy with `body`. */
function setup(body: string): { cwd: string; home: string; mdPath: string } {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "1\n2\n");
    repo.commit("init");
    repo.write("a.ts", "1\nTWO\n");
    const mdPath = runCli(["path"], repo.root, home).stdout.trim();
    runCli(["init"], repo.root, home);
    const md = readFileSync(mdPath, "utf8").replace("\n# Title\n", body);
    writeFileSync(mdPath, md);
    return { cwd: repo.root, home, mdPath };
}

describe("lint, check, fmt", () => {
    test("a good digest passes lint and check", () => {
        const s = setup("\n# Two\n\n## Changes\n\n- The second line is TWO: `a.ts:2`\n");
        expect(runCli(["lint"], s.cwd, s.home)).toMatchObject({ code: 0, stdout: "No lint issues.\n" });
        expect(runCli(["check"], s.cwd, s.home).code).toBe(0);
    });

    test("a bad anchor is a lint error (exit 5); a hunk with no anchor is a gap (exit 6)", () => {
        const bad = setup("\n# Two\n\n- see `a.ts:9`\n");
        const lint = runCli(["lint", "--json"], bad.cwd, bad.home);
        expect(lint.code).toBe(5);
        expect(envelope(lint)).toMatchObject({ ok: true, data: [{ rule: "anchor-resolves", severity: "error" }] });
        repo?.remove();
        const gap = setup("\n# Two\n\nNo anchors.\n");
        const check = runCli(["check", "--json"], gap.cwd, gap.home);
        expect(check.code).toBe(6);
        expect(envelope(check)).toMatchObject({ ok: true, data: { gaps: ["a.ts:2-2"] } });
    });

    test("fmt --check reports a change; fmt writes it and moves Questions into notes", () => {
        const s = setup("\n# Two\n\n## Questions\n\n- Why TWO?\n\n## Changes\n\n- TWO: `a.ts:2-2`\n");
        expect(runCli(["fmt", "--check"], s.cwd, s.home).code).toBe(5);
        expect(envelope(runCli(["fmt", "--questions-to-notes", "--json"], s.cwd, s.home))).toMatchObject({
            ok: true,
            data: { changed: true, questions: ["Why TWO?"] },
        });
        const md = readFileSync(s.mdPath, "utf8");
        expect(md).not.toContain("## Questions");
        expect(md).toContain("`a.ts:2`");
        expect(readComments(s.mdPath)).toMatchObject([{ author: "agent", status: "note", body: "Q: Why TWO?" }]);
        expect(runCli(["fmt", "--check"], s.cwd, s.home).code).toBe(0);
    });
});
