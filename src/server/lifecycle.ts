// Start, find, and stop the one background server for this user (spec §4). No system units.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DigestError } from "../lib/errors";
import { withLockAsync } from "../lib/lock";
import { ServerInfoSchema, type ServerInfo } from "../lib/schemas-api";
import { readJson } from "../lib/store";
import { VERSION } from "../lib/version";

const START_TIMEOUT_MS = 10_000;
const POLL_MS = 50;
const HealthSchema = z.strictObject({ version: z.string(), pid: z.int() }).readonly();

export function serverInfoPath(home: string): string {
    return join(home, "server.json");
}

export function serverLogPath(home: string): string {
    return join(home, "server.log");
}

export function readServerInfo(home: string): ServerInfo | null {
    const path = serverInfoPath(home);
    if (!existsSync(path)) return null;
    try {
        const result = ServerInfoSchema.safeParse(readJson(path));
        return result.success ? result.data : null;
    } catch {
        return null;
    }
}

export function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error instanceof Error && "code" in error && error.code === "EPERM";
    }
}

/** True when the process in `info` answers /health as this tool's server. */
export async function isHealthy(info: ServerInfo): Promise<boolean> {
    if (!isAlive(info.pid)) return false;
    try {
        const response = await fetch(`http://127.0.0.1:${info.port}/health`, { signal: AbortSignal.timeout(1000) });
        const health = HealthSchema.safeParse(await response.json());
        return health.success && health.data.pid === info.pid;
    } catch {
        return false;
    }
}

/** Calls `get` until it gives a value or the deadline passes. One call at a time: each one is a probe. */
async function poll<T>(get: () => Promise<T | null>, deadline: number): Promise<T | null> {
    const value = await get();
    if (value !== null || Date.now() >= deadline) return value;
    await Bun.sleep(POLL_MS);
    return poll(get, deadline);
}

/** Stops the server in server.json (if its process is alive) and removes server.json. */
export async function stopServer(home: string): Promise<boolean> {
    const info = readServerInfo(home);
    rmSync(serverInfoPath(home), { force: true });
    if (info === null || !isAlive(info.pid)) return false;
    process.kill(info.pid, "SIGTERM");
    const stopped = await poll(() => Promise.resolve(isAlive(info.pid) ? null : true), Date.now() + 3000);
    return stopped !== null;
}

function startDetached(command: readonly string[], home: string): void {
    const [program, ...args] = command;
    if (program === undefined) throw new DigestError("BAD_INPUT", "No command to start the server.");
    mkdirSync(home, { recursive: true });
    const log = openSync(serverLogPath(home), "a");
    try {
        const child = spawn(program, args, {
            detached: true,
            stdio: ["ignore", log, log],
            env: { ...process.env, DIFF_DIGEST_HOME: home },
        });
        child.unref();
    } finally {
        closeSync(log);
    }
}

/**
 * Returns the running server, and starts one if none answers. A server of another version is
 * stopped and replaced. `command` runs `server run` (plan 4 passes the CLI's own command).
 */
export async function ensureServer(command: readonly string[], home: string): Promise<ServerInfo> {
    const current = readServerInfo(home);
    if (current !== null && current.version === VERSION && (await isHealthy(current))) return current;
    // The lock makes two `serve` calls start one server, not two.
    return withLockAsync(serverInfoPath(home), () => startLocked(command, home), { waitMs: START_TIMEOUT_MS + 2000 });
}

async function startLocked(command: readonly string[], home: string): Promise<ServerInfo> {
    const current = readServerInfo(home);
    if (current !== null && current.version === VERSION && (await isHealthy(current))) return current;
    if (current !== null) await stopServer(home);
    startDetached(command, home);
    const started = await poll(async () => {
        const info = readServerInfo(home);
        return info !== null && (await isHealthy(info)) ? info : null;
    }, Date.now() + START_TIMEOUT_MS);
    if (started === null) {
        throw new DigestError("SERVER_DOWN", "The server did not start.", { hint: `See ${serverLogPath(home)}.` });
    }
    return started;
}
