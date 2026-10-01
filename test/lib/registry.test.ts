import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { findDigest, listDigests, registerDigest } from "../../src/lib/registry";
import { VERSION } from "../../src/lib/version";
import { expectDigestError, tempDir } from "../helpers/repo";

let dir: string | undefined;
afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("registry", () => {
    test("registers, finds, updates, and lists digests", () => {
        dir = tempDir("dd-reg-");
        const path = join(dir, "registry.json");
        expect(listDigests(path)).toEqual([]);
        registerDigest({ id: "aaaaaaaa", mdPath: "/s/a.md", root: "/r" }, path, "2026-10-01T00:00:00.000Z");
        registerDigest({ id: "bbbbbbbb", mdPath: "/s/b.md", root: "/r" }, path, "2026-10-01T00:00:00.000Z");
        registerDigest({ id: "aaaaaaaa", mdPath: "/s/moved.md", root: "/r" }, path, "2026-10-02T00:00:00.000Z");
        expect(findDigest("aaaaaaaa", path)).toEqual({
            id: "aaaaaaaa",
            mdPath: "/s/moved.md",
            root: "/r",
            updatedAt: "2026-10-02T00:00:00.000Z",
        });
        expect(listDigests(path).map(e => e.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    });

    test("an unknown id is NOT_FOUND", () => {
        dir = tempDir("dd-reg-");
        const path = join(dir, "registry.json");
        expectDigestError(() => findDigest("zzzzzzzz", path), "NOT_FOUND");
    });
});

describe("version", () => {
    test("is the same as package.json", () => {
        const pkg: unknown = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8"));
        expect(pkg).toMatchObject({ version: VERSION });
    });
});
