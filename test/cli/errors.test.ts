import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { envelope, runCli } from "../helpers/cli";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo;
let home: string;
beforeAll(() => {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "1\n");
    repo.commit("init");
});
afterAll(() => {
    repo.remove();
    rmSync(home, { recursive: true, force: true });
});

// The current branch has no working copy (no `init`), so each digest command fails with NOT_FOUND.
// `wait` resolves the digest before it calls the server, so it is NOT_FOUND too (not SERVER_DOWN).
const COMMANDS: readonly (readonly string[])[] = [
    ["lint"],
    ["check"],
    ["fmt"],
    ["comments"],
    ["comments", "--markdown"],
    ["serve"],
    ["wait"],
    ["resolve", "x", "y"],
    ["note", "a", "b"],
    ["mark", "p"],
];

describe("a digest command with no working copy", () => {
    test.each(COMMANDS.map(c => [c.join(" "), c] as const))(
        "%s --json gives the NOT_FOUND envelope and exit 4",
        (_name, args) => {
            const result = runCli([...args, "--json"], repo.root, home);
            expect(result.stderr).not.toContain("    at ");
            expect(envelope(result)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
            expect(result.code).toBe(4);
        },
    );

    test("serve with no working copy does not start a server", () => {
        expect(existsSync(join(home, "server.json"))).toBe(false);
    });
});
