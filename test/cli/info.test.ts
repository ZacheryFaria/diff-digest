import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { envelope, runCli } from "../helpers/cli";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

function setup(): { cwd: string; home: string } {
    repo = makeRepo();
    home = tempDir("dd-home-");
    return { cwd: repo.root, home };
}

describe("cli basics", () => {
    test("usage errors exit with 2", () => {
        const { cwd, home: h } = setup();
        expect(runCli(["nope"], cwd, h).code).toBe(2);
        expect(runCli(["prompt"], cwd, h).code).toBe(2);
        expect(runCli(["format", "--bogus"], cwd, h).code).toBe(2);
    });

    test("a number flag that is not a number, or is negative, is a usage error (exit 2)", () => {
        const { cwd, home: h } = setup();
        for (const args of [
            ["wait", "--timeout", "abc"],
            ["wait", "--timeout=-1"],
            ["server", "run", "--port", "x"],
            ["server", "run", "--port=-5"],
            ["server", "run", "--port", "1.5"],
        ])
            expect({ args, code: runCli(args, cwd, h).code }).toEqual({ args, code: 2 });
        expect(existsSync(join(h, "server.json"))).toBe(false);
    });

    test("--json gives the error envelope and the exit code of the error", () => {
        const { cwd, home: h } = setup();
        const result = runCli(["prompt", "nope", "--json"], cwd, h);
        expect(result.code).toBe(4);
        expect(envelope(result)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
        const text = runCli(["prompt", "nope"], cwd, h);
        expect(text.stderr).toContain("diff-digest: No prompt is named nope.");
    });

    test("format prints the format doc and the lint rule table", () => {
        const { cwd, home: h } = setup();
        const out = runCli(["format"], cwd, h).stdout;
        expect(out).toContain("# Digest format");
        expect(out).toContain("| `node-numbers` | error |");
    });

    test("config --init writes the file, and config shows the defaults", () => {
        const { cwd, home: h } = setup();
        const result = envelope(runCli(["config", "--init", "--json"], cwd, h));
        expect(result).toMatchObject({ ok: true, data: { exists: true, publishTo: ["github"], key: null } });
        expect(existsSync(join(h, "config.json"))).toBe(true);
    });

    test("schema lists the commands, prints one JSON Schema, and prints the OpenAPI spec", () => {
        const { cwd, home: h } = setup();
        expect(runCli(["schema"], cwd, h).stdout.split("\n")).toContain("config");
        expect(envelope(runCli(["schema", "config", "--json"], cwd, h))).toMatchObject({
            ok: true,
            data: { type: "object" },
        });
        expect(runCli(["schema", "--openapi"], cwd, h).stdout).toContain('"/comments/add"');
        const names = envelope(runCli(["schema", "--json"], cwd, h));
        if (!names.ok) throw new Error(JSON.stringify(names));
        const list = z.array(z.string()).parse(names.data);
        expect(list).toContain("config");
        expect(list).toContain("server status");
        expect(envelope(runCli(["schema", "server-status", "--json"], cwd, h))).toMatchObject({
            ok: true,
            data: { type: "object" },
        });
    });
});
