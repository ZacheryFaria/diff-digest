import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, rmSync } from "node:fs";
import { createApiClient } from "../../src/lib/client";
import { registerDigest, registryPath } from "../../src/lib/registry";
import type { ServerEvent } from "../../src/lib/schemas-api";
import { isAllowed, POLL_MS, startServer, type RunningServer } from "../../src/server/http";
import { makeDigest } from "../helpers/digest";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
let server: RunningServer | undefined;
afterEach(async () => {
    await server?.stop();
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

function noop(): void {
    // The tests that do not check onIdle need no action.
}

function setup(onIdle: () => void = noop, idleMs?: number): { url: string; mdPath: string } {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "1\n");
    repo.commit("init");
    const entry = makeDigest(repo, home, "# Title\n");
    registerDigest(entry, registryPath(home));
    server = startServer({ port: 0, home, onIdle, ...(idleMs === undefined ? {} : { idleMs }) });
    return { url: `http://127.0.0.1:${server.port}`, mdPath: entry.mdPath };
}

/** Opens an event stream with its own client and collects events until one of type `until`. */
async function firstEvents(url: string, until: ServerEvent["type"]): Promise<ServerEvent[]> {
    const seen: ServerEvent[] = [];
    for await (const event of await createApiClient(`${url}/rpc`).events({ id: "abcd1234" })) {
        seen.push(event);
        if (event.type === until) break;
    }
    return seen;
}

describe("isAllowed", () => {
    test("allows only this server's own host and origin", () => {
        expect(isAllowed("127.0.0.1:4777", null, 4777)).toBe(true);
        expect(isAllowed("127.0.0.1:4777", "http://127.0.0.1:4777", 4777)).toBe(true);
        expect(isAllowed("localhost:4777", null, 4777)).toBe(false);
        expect(isAllowed("127.0.0.1:4777", "http://evil.dev", 4777)).toBe(false);
        expect(isAllowed(null, null, 4777)).toBe(false);
    });
});

describe("startServer", () => {
    test("serves the contract over HTTP and the digest page", async () => {
        const { url } = setup();
        const client = createApiClient(`${url}/rpc`);
        expect((await client.digest.get({ id: "abcd1234" })).body).toBe("\n# Title\n");
        expect((await fetch(`${url}/d/abcd1234/`)).status).toBe(200);
        expect((await fetch(`${url}/nope`)).status).toBe(404);
    });

    test("rejects a request from another origin", async () => {
        const { url } = setup();
        const response = await fetch(`${url}/rpc/digest/get`, {
            method: "POST",
            headers: { origin: "http://evil.dev" },
        });
        expect(response.status).toBe(403);
    });

    test("streams a comments event, and a digest event when the file changes", async () => {
        const { url, mdPath } = setup();
        const client = createApiClient(`${url}/rpc`);
        const comments = firstEvents(url, "comments");
        await Bun.sleep(20);
        await client.comments.add({
            id: "abcd1234",
            target: { kind: "code", path: "a.ts", rev: "head", line: 1, text: "1" },
            body: "Hi.",
        });
        expect((await comments).map(e => e.type)).toEqual(["status", "comments"]);
        const digest = firstEvents(url, "digest");
        await Bun.sleep(POLL_MS + 50);
        appendFileSync(mdPath, "\nMore.\n");
        expect((await digest).at(-1)).toEqual({ type: "digest" });
    });

    test("a click in one client reaches a wait in another", async () => {
        const { url } = setup();
        const waiter = createApiClient(`${url}/rpc`);
        const clicker = createApiClient(`${url}/rpc`);
        const waiting = waiter.actions.wait({ id: "abcd1234", timeoutMs: 5000 });
        await Bun.sleep(20);
        await clicker.actions.send({ id: "abcd1234", type: "apply" });
        expect(await waiting).toMatchObject({ type: "action", action: { type: "apply", id: "abcd1234" } });
    });

    test("calls onIdle after the idle time with no requests", async () => {
        let idle = false;
        setup(() => {
            idle = true;
        }, 50);
        await Bun.sleep(150);
        expect(idle).toBe(true);
    });
});
