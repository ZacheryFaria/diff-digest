import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { z } from "zod";
import { resolveDigest } from "../../src/cli/ref";
import { findDigest, readRegistry, registryPath } from "../../src/lib/registry";
import { envelope, runCli } from "../helpers/cli";
import { expectDigestError, makeRepo, tempDir, type TestRepo } from "../helpers/repo";

const repos: TestRepo[] = [];
let home: string | undefined;
afterEach(() => {
    for (const r of repos.splice(0)) r.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

function committed(): TestRepo {
    const r = makeRepo();
    repos.push(r);
    r.write("a.ts", "1\n");
    r.commit("init");
    return r;
}

describe("the digest reference", () => {
    test("a .md path from another repo keeps the entry's root", () => {
        const a = committed();
        const b = committed();
        home = tempDir("dd-home-");
        const init = envelope(runCli(["init", "--json"], a.root, home));
        if (!init.ok) throw new Error(JSON.stringify(init));
        const { id, path } = z.object({ id: z.string(), path: z.string() }).parse(init.data);
        const before = findDigest(id, registryPath(home));
        expect(resolveDigest({ ref: path }, { cwd: b.root, home })).toEqual(before);
        expect(readRegistry(registryPath(home)).digests[id]).toEqual(before);
        const check = runCli(["check", path, "--json"], b.root, home);
        expect(envelope(check)).toMatchObject({ ok: true });
        expect(readRegistry(registryPath(home)).digests[id]?.root).toBe(a.root);
    });

    test("--id and a ref together are BAD_INPUT", () => {
        const a = committed();
        home = tempDir("dd-home-");
        runCli(["init"], a.root, home);
        expectDigestError(
            () => resolveDigest({ ref: "main", id: "abc" }, { cwd: a.root, home: home ?? "" }),
            "BAD_INPUT",
        );
    });
});
