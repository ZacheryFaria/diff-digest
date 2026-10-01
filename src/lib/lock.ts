import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DigestError } from "./errors";

/** A lock directory older than this, whose owner process is not alive, belongs to a process that stopped. */
export const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
/** The file in the lock directory that holds the owner token `<pid>-<random>`. */
export const LOCK_OWNER_FILE = "owner";
const LOCK_POLL_MS = 15;

export interface LockOptions {
    readonly waitMs?: number;
    readonly staleMs?: number;
}

interface Attempt {
    readonly file: string;
    readonly dir: string;
    readonly token: string;
    readonly deadline: number;
    readonly staleMs: number;
}

function hasCode(error: unknown, code: string): boolean {
    return error instanceof Error && "code" in error && error.code === code;
}

/** True when a process with this pid exists (EPERM: it exists, but belongs to another user). */
export function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return hasCode(error, "EPERM");
    }
}

function randomToken(): string {
    return randomBytes(6).toString("hex");
}

function readOwner(dir: string): string | null {
    try {
        return readFileSync(join(dir, LOCK_OWNER_FILE), "utf8");
    } catch {
        return null;
    }
}

function tryAcquire(dir: string, token: string): boolean {
    try {
        mkdirSync(dir);
    } catch (error) {
        if (hasCode(error, "EEXIST")) return false;
        throw error;
    }
    writeFileSync(join(dir, LOCK_OWNER_FILE), token);
    return true;
}

/** The owner token when the lock is stale: old, and its owner pid (if it has one) is not alive. */
function staleOwner(dir: string, staleMs: number): string | null {
    let mtime: number;
    try {
        mtime = statSync(dir).mtimeMs;
    } catch {
        return null;
    }
    if (Date.now() - mtime <= staleMs) return null;
    const owner = readOwner(dir) ?? "";
    const pid = /^(\d+)-/u.exec(owner)?.[1];
    return pid !== undefined && isAlive(Number(pid)) ? null : owner;
}

/**
 * Moves a stale lock away, then removes it. `rename` is atomic, so only one waiter moves it. If the
 * moved lock is not the one that was found stale (a new holder took the lock in between), it goes back.
 */
function takeOver(dir: string, owner: string): void {
    const moved = `${dir}.stale-${randomToken()}`;
    try {
        renameSync(dir, moved);
    } catch {
        return;
    }
    if ((readOwner(moved) ?? "") !== owner) {
        try {
            renameSync(moved, dir);
            return;
        } catch {
            // Another waiter has the lock now. The moved holder does not remove it (its token differs).
        }
    }
    rmSync(moved, { recursive: true, force: true });
}

/** One try: true when the lock is ours. Takes over a stale lock, and throws LOCKED after the deadline. */
function step(attempt: Attempt): boolean {
    if (tryAcquire(attempt.dir, attempt.token)) return true;
    const owner = staleOwner(attempt.dir, attempt.staleMs);
    if (owner !== null) {
        takeOver(attempt.dir, owner);
        return tryAcquire(attempt.dir, attempt.token);
    }
    if (Date.now() > attempt.deadline) {
        throw new DigestError("LOCKED", `${attempt.file} is locked by another process.`, {
            hint: `Remove ${attempt.dir} if no process uses it.`,
        });
    }
    return false;
}

function prepare(file: string, options: LockOptions): Attempt {
    const dir = `${file}.lock`;
    mkdirSync(dirname(dir), { recursive: true });
    return {
        file,
        dir,
        token: `${process.pid}-${randomToken()}`,
        deadline: Date.now() + (options.waitMs ?? LOCK_WAIT_MS),
        staleMs: options.staleMs ?? LOCK_STALE_MS,
    };
}

/** Removes the lock only when it still holds our token (a waiter can take over a lock that we held too long). */
function release(attempt: Attempt): void {
    if (readOwner(attempt.dir) === attempt.token) rmSync(attempt.dir, { recursive: true, force: true });
}

/**
 * Runs `run` while this process holds the lock for `file`. The lock is the directory `<file>.lock`,
 * because `mkdir` is atomic. Use it for every read-modify-write of a shared file.
 */
export function withLock<T>(file: string, run: () => T, options: LockOptions = {}): T {
    const attempt = prepare(file, options);
    while (!step(attempt)) Bun.sleepSync(LOCK_POLL_MS);
    try {
        return run();
    } finally {
        release(attempt);
    }
}

async function acquireAsync(attempt: Attempt): Promise<void> {
    if (step(attempt)) return;
    await Bun.sleep(LOCK_POLL_MS);
    await acquireAsync(attempt);
}

/** `withLock` for async work: the lock is held until the promise settles, and waiting does not block. */
export async function withLockAsync<T>(file: string, run: () => Promise<T>, options: LockOptions = {}): Promise<T> {
    const attempt = prepare(file, options);
    await acquireAsync(attempt);
    try {
        return await run();
    } finally {
        release(attempt);
    }
}
