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

const COMMAND = ["bun", join(import.meta.dir, "../../src/server/main.ts")] as const;
let home: string | undefined;
afterEach(async () => {
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
        expect(await stopServer(home)).toBe(true);
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
});
