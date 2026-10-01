import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCK_OWNER_FILE, withLock, withLockAsync } from "../../src/lib/lock";
import { expectDigestError, tempDir } from "../helpers/repo";

let dir: string | undefined;
afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("withLock", () => {
    test("runs the function, returns its value, and removes the lock", () => {
        dir = tempDir("dd-lock-");
        const file = join(dir, "f.json");
        expect(withLock(file, () => 7)).toBe(7);
        expect(withLock(file, () => 8)).toBe(8);
    });

    test("removes the lock when the function throws", () => {
        dir = tempDir("dd-lock-");
        const file = join(dir, "f.json");
        expect(() =>
            withLock(file, () => {
                throw new Error("boom");
            }),
        ).toThrow("boom");
        expect(withLock(file, () => "free")).toBe("free");
    });

    test("a held lock makes a second caller wait, then fail with LOCKED", () => {
        dir = tempDir("dd-lock-");
        const file = join(dir, "f.json");
        mkdirSync(`${file}.lock`);
        expectDigestError(() => withLock(file, () => 1, { waitMs: 50 }), "LOCKED");
    });

    test("a stale lock is removed", () => {
        dir = tempDir("dd-lock-");
        const file = join(dir, "f.json");
        mkdirSync(`${file}.lock`);
        const old = (Date.now() - 60_000) / 1000;
        utimesSync(`${file}.lock`, old, old);
        expect(withLock(file, () => "ok", { waitMs: 50 })).toBe("ok");
    });

    test("withLockAsync holds the lock until the promise settles", async () => {
        dir = tempDir("dd-lock-");
        const file = join(dir, "f.json");
        const order: string[] = [];
        await Promise.all([
            withLockAsync(file, async () => {
                await Bun.sleep(30);
                order.push("first");
            }),
            (async () => {
                await Bun.sleep(5);
                await withLockAsync(file, () => {
                    order.push("second");
                    return Promise.resolve();
                });
            })(),
        ]);
        expect(order).toEqual(["first", "second"]);
    });

    test("an old lock that a live process holds is not taken over", () => {
        dir = tempDir("dd-lock-");
        const file = join(dir, "f.json");
        oldLock(file, `${process.pid}-held`);
        expectDigestError(() => withLock(file, () => 1, { waitMs: 50 }), "LOCKED");
        expect(readFileSync(join(`${file}.lock`, LOCK_OWNER_FILE), "utf8")).toBe(`${process.pid}-held`);
    });

    test("an old lock whose process is dead is taken over", async () => {
        dir = tempDir("dd-lock-");
        const file = join(dir, "f.json");
        oldLock(file, `${await deadPid()}-gone`);
        expect(withLock(file, () => "ok", { waitMs: 50 })).toBe("ok");
        expect(await withLockAsync(file, () => Promise.resolve("ok"), { waitMs: 50 })).toBe("ok");
        oldLock(file, `${await deadPid()}-gone`);
        expect(await withLockAsync(file, () => Promise.resolve("async"), { waitMs: 50 })).toBe("async");
    });

    test("a holder whose lock was taken over does not remove the new holder's lock", async () => {
        dir = tempDir("dd-lock-");
        const file = join(dir, "f.json");
        const lock = `${file}.lock`;
        const steal = (): void => {
            rmSync(lock, { recursive: true, force: true });
            mkdirSync(lock);
            writeFileSync(join(lock, LOCK_OWNER_FILE), "1-other");
        };
        withLock(file, steal);
        expect(existsSync(lock)).toBe(true);
        rmSync(lock, { recursive: true, force: true });
        await withLockAsync(file, () => {
            steal();
            return Promise.resolve();
        });
        expect(readFileSync(join(lock, LOCK_OWNER_FILE), "utf8")).toBe("1-other");
    });
});

/** A lock directory for `file` with the owner token `owner` and an mtime one minute ago. */
function oldLock(file: string, owner: string): void {
    const lock = `${file}.lock`;
    mkdirSync(lock);
    writeFileSync(join(lock, LOCK_OWNER_FILE), owner);
    const old = (Date.now() - 60_000) / 1000;
    utimesSync(lock, old, old);
}

/** The pid of a process that has exited. */
async function deadPid(): Promise<number> {
    const child = Bun.spawn(["true"]);
    await child.exited;
    return child.pid;
}
