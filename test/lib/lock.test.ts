import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { withLock } from "../../src/lib/lock";
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
});
