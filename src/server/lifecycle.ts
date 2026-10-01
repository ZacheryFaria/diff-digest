// Start, find, and stop the one background server for this user (spec §4). No system units.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DigestError } from "../lib/errors";
import { isAlive, withLockAsync } from "../lib/lock";
import { ServerInfoSchema, type ServerInfo } from "../lib/schemas-api";
import { readJson } from "../lib/store";
import { VERSION } from "../lib/version";

export { isAlive } from "../lib/lock";

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 3000;
const KILL_TIMEOUT_MS = 2000;
const HEALTH_TIMEOUT_MS = 1000;
/**
 * The longest time that `startLocked` can hold the lock: one health probe, the stop (a probe, SIGTERM,
 * SIGKILL), and the start (its last probe can start just before the deadline). A second caller waits longer.
 */
const LOCK_WAIT_MS = 3 * HEALTH_TIMEOUT_MS + STOP_TIMEOUT_MS + KILL_TIMEOUT_MS + START_TIMEOUT_MS + 2000;
const POLL_MS = 50;
const HealthSchema = z.strictObject({ version: z.string(), pid: z.int() }).readonly();
type Health = z.infer<typeof HealthSchema>;

/** What `stopServer` did: no server answered, the server stopped, or it did not stop in time. */
export type StopResult = "none" | "stopped" | "timeout";

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

/** The /health answer at `port`, or null when no server of this tool answers. */
async function readHealth(port: number): Promise<Health | null> {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        const health = HealthSchema.safeParse(await response.json());
        return health.success ? health.data : null;
    } catch {
        return null;
    }
}

/** True when the process in `info` answers /health as this tool's server (of any version). */
export async function isHealthy(info: ServerInfo): Promise<boolean> {
    return isAlive(info.pid) && (await readHealth(info.port))?.pid === info.pid;
}

/** True when server.json and the /health answer both name this version, and /health has the same pid. */
async function isCurrent(info: ServerInfo): Promise<boolean> {
    if (info.version !== VERSION || !isAlive(info.pid)) return false;
    const health = await readHealth(info.port);
    return health?.pid === info.pid && health.version === VERSION;
}

/** Calls `get` until it gives a value or the deadline passes. One call at a time: each one is a probe. */
async function poll<T>(get: () => Promise<T | null>, deadline: number): Promise<T | null> {
    const value = await get();
    if (value !== null || Date.now() >= deadline) return value;
    await Bun.sleep(POLL_MS);
    return poll(get, deadline);
}

function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
    return poll(() => Promise.resolve(isAlive(pid) ? null : true), Date.now() + timeoutMs).then(done => done !== null);
}

function removeInfo(home: string, pid: number): void {
    if (readServerInfo(home)?.pid === pid) rmSync(serverInfoPath(home), { force: true });
}

/**
 * Stops the server in `info`. Only a process that answers /health with the same pid gets SIGTERM:
 * the pid in a stale server.json can belong to another program now. A stale server.json is removed.
 */
async function stopInfo(home: string, info: ServerInfo | null): Promise<StopResult> {
    if (info === null || !(await isHealthy(info))) {
        rmSync(serverInfoPath(home), { force: true });
        return "none";
    }
    process.kill(info.pid, "SIGTERM");
    if (!(await waitForExit(info.pid, STOP_TIMEOUT_MS))) return "timeout";
    removeInfo(home, info.pid);
    return "stopped";
}

/** Stops the server in server.json, if it answers /health, and removes server.json. */
export function stopServer(home: string): Promise<StopResult> {
    return stopInfo(home, readServerInfo(home));
}

/** Stops the server in `info`. A server that does not stop after SIGTERM gets SIGKILL. */
async function replace(home: string, info: ServerInfo): Promise<void> {
    if ((await stopInfo(home, info)) !== "timeout") return;
    try {
        process.kill(info.pid, "SIGKILL");
    } catch {
        // It stopped between the check and the signal.
    }
    if (!(await waitForExit(info.pid, KILL_TIMEOUT_MS))) {
        throw new DigestError("SERVER_DOWN", `The old server (pid ${info.pid}) did not stop.`, {
            hint: `Stop the process ${info.pid}, then try again.`,
        });
    }
    removeInfo(home, info.pid);
}

/** The error of the start, if the program could not run. */
interface Started {
    readonly error: () => Error | undefined;
}

function startDetached(command: readonly string[], home: string): Started {
    const [program, ...args] = command;
    if (program === undefined) throw new DigestError("BAD_INPUT", "No command to start the server.");
    mkdirSync(home, { recursive: true });
    const log = openSync(serverLogPath(home), "a");
    let failure: Error | undefined;
    try {
        const child = spawn(program, args, {
            detached: true,
            stdio: ["ignore", log, log],
            env: { ...process.env, DIFF_DIGEST_HOME: home },
        });
        child.once("error", error => {
            failure = error;
        });
        child.unref();
    } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
    } finally {
        closeSync(log);
    }
    return { error: () => failure };
}

/**
 * Returns the running server, and starts one if none answers. A server of another version is
 * stopped and replaced. `command` runs `server run` (plan 4 passes the CLI's own command).
 */
export async function ensureServer(command: readonly string[], home: string): Promise<ServerInfo> {
    const current = readServerInfo(home);
    if (current !== null && (await isCurrent(current))) return current;
    // The lock makes two `serve` calls start one server, not two.
    return withLockAsync(serverInfoPath(home), () => startLocked(command, home), { waitMs: LOCK_WAIT_MS });
}

async function startLocked(command: readonly string[], home: string): Promise<ServerInfo> {
    const current = readServerInfo(home);
    if (current !== null && (await isCurrent(current))) return current;
    if (current !== null) await replace(home, current);
    const start = startDetached(command, home);
    const started = await poll(async () => {
        const error = start.error();
        if (error !== undefined) {
            throw new DigestError("SERVER_DOWN", `The server did not start: ${error.message}`, {
                hint: `See ${serverLogPath(home)}.`,
            });
        }
        const info = readServerInfo(home);
        return info !== null && (await isHealthy(info)) ? info : null;
    }, Date.now() + START_TIMEOUT_MS);
    if (started === null) {
        throw new DigestError("SERVER_DOWN", "The server did not start.", { hint: `See ${serverLogPath(home)}.` });
    }
    return started;
}
