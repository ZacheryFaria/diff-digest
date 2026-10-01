import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../../src/lib/store";
import {
    ensureServer,
    isAlive,
    isHealthy,
    readServerInfo,
    serverInfoPath,
    stopServer,
} from "../../src/server/lifecycle";
import { tempDir } from "../helpers/repo";
import { waitUntil } from "../helpers/wait";

const COMMAND = ["bun", join(import.meta.dir, "../../src/server/main.ts")] as const;
let home: string | undefined;
let sleeper: ReturnType<typeof Bun.spawn> | undefined;
afterEach(async () => {
    sleeper?.kill();
    sleeper = undefined;
    if (home !== undefined) {
        await stopServer(home);
        rmSync(home, { recursive: true, force: true });
    }
});

describe("lifecycle", () => {
    test("starts one server, reuses it, and stops it", async () => {
        home = tempDir("dd-life-");
        const [a, b] = await Promise.all([ensureServer(COMMAND, home), ensureServer(COMMAND, home)]);
        expect(a.pid).toBe(b.pid);
        expect(await isHealthy(a)).toBe(true);
        expect((await ensureServer(COMMAND, home)).pid).toBe(a.pid);
        expect(await stopServer(home)).toBe("stopped");
        expect(isAlive(a.pid)).toBe(false);
        expect(existsSync(serverInfoPath(home))).toBe(false);
    }, 20_000);

    test("replaces a stale server.json and a server of another version", async () => {
        home = tempDir("dd-life-");
        writeAtomic(
            serverInfoPath(home),
            JSON.stringify({ pid: 999_999, port: 1, version: "0.2.0", startedAt: new Date().toISOString() }),
        );
        const first = await ensureServer(COMMAND, home);
        expect(first.pid).not.toBe(999_999);
        writeAtomic(serverInfoPath(home), JSON.stringify({ ...first, version: "0.0.1" }));
        const second = await ensureServer(COMMAND, home);
        expect(second.pid).not.toBe(first.pid);
        expect(isAlive(first.pid)).toBe(false);
        expect(readServerInfo(home)?.pid).toBe(second.pid);
    }, 20_000);

    test("does not signal a pid in server.json that does not answer /health", async () => {
        home = tempDir("dd-life-");
        sleeper = Bun.spawn(["sleep", "30"]);
        writeAtomic(
            serverInfoPath(home),
            JSON.stringify({ pid: sleeper.pid, port: 1, version: "0.0.1", startedAt: new Date().toISOString() }),
        );
        const started = await ensureServer(COMMAND, home);
        expect(started.pid).not.toBe(sleeper.pid);
        expect(isAlive(sleeper.pid)).toBe(true);
    }, 20_000);

    test("a server does not remove a server.json that another pid wrote", async () => {
        home = tempDir("dd-life-");
        const started = await ensureServer(COMMAND, home);
        const other = { ...started, pid: process.pid };
        writeAtomic(serverInfoPath(home), JSON.stringify(other));
        process.kill(started.pid, "SIGTERM");
        await waitUntil(() => !isAlive(started.pid), 5000);
        expect(readServerInfo(home)).toEqual(other);
    }, 20_000);

    test("a command that does not exist fails fast with SERVER_DOWN", async () => {
        home = tempDir("dd-life-");
        const begin = Date.now();
        const failure = await ensureServer(["/no/such/program"], home).catch((error: unknown) => error);
        expect(failure).toMatchObject({ code: "SERVER_DOWN" });
        expect(Date.now() - begin).toBeLessThan(2000);
    }, 20_000);
});
