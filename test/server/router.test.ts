import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { createRouterClient, ORPCError, type RouterClient } from "@orpc/server";
import { registerDigest, registryPath } from "../../src/lib/registry";
import type { ServerEvent } from "../../src/lib/schemas-api";
import { createServerContext } from "../../src/server/context";
import { router } from "../../src/server/router";
import { makeDigest } from "../helpers/digest";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

const BODY = "# Title\n\n## Changes\n\n- `a.ts` returns two: `a.ts:1`\n";
const TARGET = { kind: "code", path: "a.ts", rev: "head", line: 1, text: "2" } as const;

function setup(): { client: RouterClient<typeof router> } {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "1\n");
    repo.commit("init");
    repo.write("a.ts", "2\n");
    const entry = makeDigest(repo, home, BODY);
    registerDigest(entry, registryPath(home));
    let n = 0;
    const context = {
        ...createServerContext(home),
        now: () => "2026-10-01T00:00:00.000Z",
        newId: () => `c${(n += 1)}`,
    };
    return { client: createRouterClient(router, { context }) };
}

describe("router", () => {
    test("digest.get, digest.check, and the file views", async () => {
        const { client } = setup();
        const payload = await client.digest.get({ id: "abcd1234" });
        expect(payload.files.map(f => f.path)).toEqual(["a.ts"]);
        expect(await client.digest.check({ id: "abcd1234" })).toEqual({ issues: [], gaps: [] });
        expect((await client.files.diff({ id: "abcd1234", path: "a.ts" })).text).toContain("+2");
        expect((await client.files.read({ id: "abcd1234", path: "a.ts", rev: "base" })).text).toBe("1\n");
    });

    test("comments: add, resolve, note, markShared, remove", async () => {
        const { client } = setup();
        const added = await client.comments.add({ id: "abcd1234", target: TARGET, body: "Why two?" });
        expect(added).toMatchObject({ id: "c1", author: "user", status: "open", created: "2026-10-01T00:00:00.000Z" });
        expect(await client.comments.resolve({ id: "abcd1234", commentId: "c1", reply: "Because." })).toMatchObject({
            status: "resolved",
            reply: "Because.",
        });
        const note = await client.comments.note({ id: "abcd1234", text: "returns two", body: "Checked." });
        expect(note.target).toMatchObject({ kind: "digest", section: "Changes" });
        const shared = await client.comments.markShared({ id: "abcd1234", commentIds: ["c1"], ref: "https://x/1" });
        expect(shared.find(c => c.id === "c1")).toMatchObject({ status: "shared", ref: "https://x/1" });
        await client.comments.remove({ id: "abcd1234", commentId: "c2" });
        expect((await client.comments.list({ id: "abcd1234" })).map(c => c.id)).toEqual(["c1"]);
    });

    test("errors keep the DigestError code", async () => {
        const { client } = setup();
        const failure = await client.comments
            .resolve({ id: "abcd1234", commentId: "nope", reply: "x" })
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ORPCError);
        expect(failure).toMatchObject({ code: "NOT_FOUND" });
        const unknown = await client.digest.get({ id: "zzzzzzzz" }).catch((error: unknown) => error);
        expect(unknown).toMatchObject({ code: "NOT_FOUND" });
        const bad = await client.comments
            .add({ id: "abcd1234", target: TARGET, body: "" })
            .catch((error: unknown) => error);
        expect(bad).toMatchObject({ code: "BAD_REQUEST" });
    });

    test("actions: a queued click goes to the next wait; a wait gets a later click", async () => {
        const { client } = setup();
        await client.comments.add({ id: "abcd1234", target: TARGET, body: "Fix it." });
        expect(await client.actions.send({ id: "abcd1234", type: "apply" })).toEqual({ listening: 0, queued: 1 });
        const first = await client.actions.wait({ id: "abcd1234", timeoutMs: 1000 });
        expect(first).toMatchObject({ type: "action", action: { type: "apply", comments: [{ body: "Fix it." }] } });
        const waiting = client.actions.wait({ id: "abcd1234", timeoutMs: 1000 });
        await Bun.sleep(5);
        expect(await client.actions.status({ id: "abcd1234" })).toEqual({ listening: 1, queued: 0 });
        await client.actions.send({ id: "abcd1234", type: "review" });
        expect(await waiting).toMatchObject({ type: "action", action: { type: "review" } });
        expect(await client.actions.wait({ id: "abcd1234", timeoutMs: 10 })).toEqual({ type: "timeout" });
    });

    test("events: the stream starts with the status and gets a comments event", async () => {
        const { client } = setup();
        const stream = await client.events({ id: "abcd1234" });
        const seen: ServerEvent[] = [];
        const reading = (async () => {
            for await (const event of stream) {
                seen.push(event);
                if (event.type === "comments") break;
            }
        })();
        await Bun.sleep(5);
        await client.comments.add({ id: "abcd1234", target: TARGET, body: "Hi." });
        await reading;
        expect(seen).toEqual([{ type: "status", status: { listening: 0, queued: 0 } }, { type: "comments" }]);
    });
});
