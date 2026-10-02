import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ServeOutputSchema } from "../../src/cli/outputs";
import { serverCall } from "../../src/cli/self";
import { createApiClient } from "../../src/lib/client";
import { stopServer } from "../../src/server/lifecycle";
import { envelope, runCli } from "../helpers/cli";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";
import { waitUntil } from "../helpers/wait";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");
let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(async () => {
    if (home !== undefined) {
        await stopServer(home);
        rmSync(home, { recursive: true, force: true });
    }
    repo?.remove();
});

function setup(): { cwd: string; home: string } {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "1\n");
    repo.commit("init");
    runCli(["init"], repo.root, home);
    return { cwd: repo.root, home };
}

describe("server commands", () => {
    test("serve starts one server; wait gets a click; stop stops it", async () => {
        const s = setup();
        const served = envelope(runCli(["serve", "--json"], s.cwd, s.home));
        if (!served.ok) throw new Error(JSON.stringify(served));
        const { url, id } = ServeOutputSchema.parse(served.data);
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/d\/[0-9a-z]{8}\/$/u);
        expect(envelope(runCli(["serve", "--json"], s.cwd, s.home))).toMatchObject({ ok: true, data: { url } });
        const log = runCli(["server", "logs"], s.cwd, s.home).stdout;
        expect(log).toMatch(/^diff-digest server \S+ pid \d+ port \d+$/mu);
        const status = envelope(runCli(["server", "status", "--json"], s.cwd, s.home));
        expect(status).toMatchObject({ ok: true, data: { running: true, digests: [{ id }] } });

        const waiting = Bun.spawn(["bun", CLI, "wait", "--timeout", "10", "--json"], {
            cwd: s.cwd,
            env: { ...process.env, DIFF_DIGEST_HOME: s.home },
            stdout: "pipe",
        });
        const api = createApiClient(new URL("/rpc", url).toString());
        await waitUntil(async () => (await api.actions.status({ id })).listening === 1, 5000);
        await api.actions.send({ id, type: "apply" });
        const out = await new Response(waiting.stdout).text();
        expect(JSON.parse(out)).toMatchObject({ ok: true, data: { type: "action", action: { type: "apply", id } } });

        expect(envelope(runCli(["server", "stop", "--json"], s.cwd, s.home))).toMatchObject({
            ok: true,
            data: { result: "stopped" },
        });
        expect(envelope(runCli(["server", "status", "--json"], s.cwd, s.home))).toMatchObject({
            ok: true,
            data: { running: false },
        });
    }, 30_000);

    test("wait with a stale server.json is SERVER_DOWN (exit 11)", () => {
        const s = setup();
        const info = { pid: process.pid, port: 1, version: "0.0.0", startedAt: "2026-10-01T00:00:00.000Z" };
        writeFileSync(join(s.home, "server.json"), JSON.stringify(info));
        const result = runCli(["wait", "--timeout", "1", "--json"], s.cwd, s.home);
        expect(envelope(result)).toMatchObject({
            ok: false,
            error: { code: "SERVER_DOWN", hint: "Run `diff-digest serve`." },
        });
        expect(result.code).toBe(11);
    });

    test("a connection error from the server is SERVER_DOWN", async () => {
        const error = await serverCall(() => Promise.reject(new TypeError("Unable to connect."))).then(
            () => null,
            (failure: unknown) => failure,
        );
        expect(error).toMatchObject({ code: "SERVER_DOWN", hint: "Run `diff-digest serve`." });
    });

    test("wait with no server is SERVER_DOWN (exit 11)", () => {
        const s = setup();
        const result = runCli(["wait", "--json"], s.cwd, s.home);
        expect(result.code).toBe(11);
        expect(envelope(result)).toMatchObject({ ok: false, error: { code: "SERVER_DOWN" } });
    });
});
