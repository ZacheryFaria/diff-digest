import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildBinary } from "../../scripts/build";
import { ServeOutputSchema } from "../../src/cli/outputs";
import { VERSION } from "../../src/lib/version";
import { envelope, type CliResult } from "../helpers/cli";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

/** A warm `--help` must take less than this (spec §12). */
const HELP_MS = 50;
/** The page's first script must not hold mermaid: it loads only when a digest has a diagram. */
const MAX_ENTRY_BYTES = 2_000_000;

let dir = "";
let binary = "";
let home = "";
let repo: TestRepo | undefined;

function run(args: readonly string[], cwd: string): CliResult {
    const result = Bun.spawnSync([binary, ...args], {
        cwd,
        env: { ...process.env, DIFF_DIGEST_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
    });
    return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

beforeAll(() => {
    dir = tempDir("dd-build-");
    home = join(dir, "home");
    binary = buildBinary(join(dir, "diff-digest"));
});

afterAll(() => {
    if (repo !== undefined) run(["server", "stop"], repo.root);
    repo?.remove();
    rmSync(dir, { recursive: true, force: true });
});

describe("the binary", () => {
    test("prints the version, and a warm --help is fast", () => {
        expect(run(["--version"], dir).stdout.trim()).toBe(VERSION);
        // The first run of a new binary can be slow (the system checks it), so it does not count.
        run(["--help"], dir);
        const times = Array.from({ length: 5 }, () => {
            const start = performance.now();
            run(["--help"], dir);
            return performance.now() - start;
        }).toSorted((a, b) => a - b);
        expect(times[2] ?? Infinity).toBeLessThan(HELP_MS);
    });

    test("serves the page with production React, and mermaid is not in the first script", async () => {
        repo = makeRepo();
        repo.write("a.ts", "1\n");
        repo.commit("init");
        run(["init"], repo.root);
        const served = envelope(run(["serve", "--json"], repo.root));
        if (!served.ok) throw new Error(JSON.stringify(served));
        const { url } = ServeOutputSchema.parse(served.data);
        const html = await (await fetch(url)).text();
        const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/gu)].map(m => m[1] ?? "");
        expect(scripts.length).toBeGreaterThan(0);
        const bodies = await Promise.all(scripts.map(async s => (await fetch(new URL(s, url))).text()));
        for (const body of bodies) {
            expect(body).not.toContain("Download the React DevTools");
            expect(body.length).toBeLessThan(MAX_ENTRY_BYTES);
        }
    }, 60_000);

    test("export uses the bundle inside the binary", () => {
        const root = repo?.root ?? dir;
        const out = join(dir, "export.html");
        expect(run(["export", "--out", out], root).code).toBe(0);
        const html = readFileSync(out, "utf8");
        expect(html).toContain('<script id="digest-payload" type="application/json">');
        expect(html).not.toContain("Download the React DevTools");
    }, 30_000);
});
