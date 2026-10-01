import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DigestError } from "./errors";

/** A lock directory older than this belongs to a process that stopped without unlocking. */
export const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 15;

export interface LockOptions {
    readonly waitMs?: number;
    readonly staleMs?: number;
}

function tryAcquire(dir: string): boolean {
    try {
        mkdirSync(dir);
        return true;
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
        throw error;
    }
}

function isStale(dir: string, staleMs: number): boolean {
    try {
        return Date.now() - statSync(dir).mtimeMs > staleMs;
    } catch {
        return false;
    }
}

/**
 * Runs `run` while this process holds the lock for `file`. The lock is the directory `<file>.lock`,
 * because `mkdir` is atomic. Use it for every read-modify-write of a shared file.
 */
export function withLock<T>(file: string, run: () => T, options: LockOptions = {}): T {
    const dir = `${file}.lock`;
    mkdirSync(dirname(dir), { recursive: true });
    const deadline = Date.now() + (options.waitMs ?? LOCK_WAIT_MS);
    while (!tryAcquire(dir)) {
        if (isStale(dir, options.staleMs ?? LOCK_STALE_MS)) {
            rmSync(dir, { recursive: true, force: true });
            continue;
        }
        if (Date.now() > deadline) {
            throw new DigestError("LOCKED", `${file} is locked by another process.`, {
                hint: `Remove ${dir} if no process uses it.`,
            });
        }
        Bun.sleepSync(LOCK_POLL_MS);
    }
    try {
        return run();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function acquireAsync(dir: string, deadline: number, staleMs: number, file: string): Promise<void> {
    if (tryAcquire(dir)) return;
    if (isStale(dir, staleMs)) {
        rmSync(dir, { recursive: true, force: true });
        await acquireAsync(dir, deadline, staleMs, file);
        return;
    }
    if (Date.now() > deadline) {
        throw new DigestError("LOCKED", `${file} is locked by another process.`, {
            hint: `Remove ${dir} if no process uses it.`,
        });
    }
    await Bun.sleep(LOCK_POLL_MS);
    await acquireAsync(dir, deadline, staleMs, file);
}

/** `withLock` for async work: the lock is held until the promise settles, and waiting does not block. */
export async function withLockAsync<T>(file: string, run: () => Promise<T>, options: LockOptions = {}): Promise<T> {
    const dir = `${file}.lock`;
    mkdirSync(dirname(dir), { recursive: true });
    await acquireAsync(dir, Date.now() + (options.waitMs ?? LOCK_WAIT_MS), options.staleMs ?? LOCK_STALE_MS, file);
    try {
        return await run();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
