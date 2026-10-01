import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { createApiClient } from "../../src/lib/client";
import { registerDigest, registryPath } from "../../src/lib/registry";
import type { ServerEvent } from "../../src/lib/schemas-api";
import { isAllowed, POLL_MS, pollChanges, startServer, type RunningServer } from "../../src/server/http";
import { makeDigest } from "../helpers/digest";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";
import { waitUntil } from "../helpers/wait";

interface Stream {
    readonly seen: readonly ServerEvent[];
    readonly close: () => Promise<void>;
}

let repo: TestRepo | undefined;
let home: string | undefined;
let server: RunningServer | undefined;
let stopPolling: (() => void) | undefined;
const streams: Stream[] = [];
afterEach(async () => {
    await Promise.all(streams.splice(0).map(s => s.close()));
    stopPolling?.();
    stopPolling = undefined;
    await server?.stop();
    server = undefined;
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

function noop(): void {
    // The tests that do not check onIdle need no action.
}

function setupDigest(): string {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "1\n");
    repo.commit("init");
    const entry = makeDigest(repo, home, "# Title\n");
    registerDigest(entry, registryPath(home));
    return entry.mdPath;
}

function setup(onIdle: () => void = noop, idleMs?: number): { url: string; mdPath: string } {
    const mdPath = setupDigest();
    server = startServer({ port: 0, home: home ?? "", onIdle, ...(idleMs === undefined ? {} : { idleMs }) });
    return { url: `http://127.0.0.1:${server.port}`, mdPath };
}

/** Opens an event stream with its own client. `seen` fills while it is open; `close` ends it. */
function openStream(url: string): Stream {
    const seen: ServerEvent[] = [];
    const controller = new AbortController();
    const reading = (async () => {
        const client = createApiClient(`${url}/rpc`);
        try {
            for await (const event of await client.events({ id: "abcd1234" }, { signal: controller.signal })) {
                seen.push(event);
            }
        } catch {
            // The stream ends with an abort error when the test closes it.
        }
    })();
    const stream = {
        seen,
        close: async () => {
            controller.abort();
            await reading;
        },
    };
    streams.push(stream);
    return stream;
}

function has(stream: Stream, type: ServerEvent["type"]): boolean {
    return stream.seen.some(e => e.type === type);
}

function count(stream: Stream, type: ServerEvent["type"]): number {
    return stream.seen.filter(e => e.type === type).length;
}

/** Changes the file until the stream gets a new event of `type` (the poller sees the file only after a tick). */
async function touchUntil(path: string, stream: Stream, type: ServerEvent["type"]): Promise<void> {
    const before = count(stream, type);
    await waitUntil(() => {
        appendFileSync(path, "\nMore.\n");
        return count(stream, type) > before;
    }, 3000);
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

describe("pollChanges", () => {
    test("a broken registry.json does not stop polling, and logs one line for the same error", async () => {
        const mdPath = setupDigest();
        const published: string[] = [];
        const errors: string[] = [];
        stopPolling = pollChanges(home ?? "", {
            has: () => true,
            publish: (id, type) => {
                published.push(`${id} ${type}`);
            },
            onError: message => {
                errors.push(message);
            },
        });
        await Bun.sleep(POLL_MS + 50);
        writeFileSync(registryPath(home), "{ not json");
        await waitUntil(() => {
            appendFileSync(mdPath, "\nMore.\n");
            return published.includes("abcd1234 digest");
        }, 3000);
        await Bun.sleep(POLL_MS * 3);
        expect(errors).toHaveLength(1);
    });

    test("polls only the digests that have a subscriber", async () => {
        const mdPath = setupDigest();
        const published: string[] = [];
        stopPolling = pollChanges(home ?? "", {
            has: () => false,
            publish: (id, type) => {
                published.push(`${id} ${type}`);
            },
        });
        await Bun.sleep(POLL_MS + 50);
        appendFileSync(mdPath, "\nMore.\n");
        await Bun.sleep(POLL_MS * 2);
        expect(published).toEqual([]);
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

    test("rejects a request with another Host header", async () => {
        const { url } = setup();
        expect((await fetch(`${url}/health`)).status).toBe(200);
        expect((await fetch(`${url}/health`, { headers: { host: "evil.dev" } })).status).toBe(403);
    });

    test("a GET to a procedure gives 405", async () => {
        const { url } = setup();
        expect((await fetch(`${url}/rpc/digest/get`)).status).toBe(405);
    });

    test("streams a comments event, and a digest event when the file changes", async () => {
        const { url, mdPath } = setup();
        const client = createApiClient(`${url}/rpc`);
        const stream = openStream(url);
        await waitUntil(() => has(stream, "status"));
        await client.comments.add({
            id: "abcd1234",
            target: { kind: "code", path: "a.ts", rev: "head", line: 1, text: "1" },
            body: "Hi.",
        });
        await waitUntil(() => has(stream, "comments"));
        expect(stream.seen.map(e => e.type).slice(0, 2)).toEqual(["status", "comments"]);
        await touchUntil(mdPath, stream, "digest");
    });

    test("a broken registry.json does not stop the server or the change polling", async () => {
        const { url, mdPath } = setup();
        const stream = openStream(url);
        await waitUntil(() => has(stream, "status"));
        await touchUntil(mdPath, stream, "digest");
        writeFileSync(registryPath(home), "{ not json");
        await touchUntil(mdPath, stream, "digest");
        expect((await fetch(`${url}/health`)).status).toBe(200);
    });

    test("a click in one client reaches a wait in another", async () => {
        const { url } = setup();
        const waiter = createApiClient(`${url}/rpc`);
        const clicker = createApiClient(`${url}/rpc`);
        const waiting = waiter.actions.wait({ id: "abcd1234", timeoutMs: 5000 });
        await waitUntil(async () => (await clicker.actions.status({ id: "abcd1234" })).listening === 1);
        await clicker.actions.send({ id: "abcd1234", type: "apply" });
        expect(await waiting).toMatchObject({ type: "action", action: { type: "apply", id: "abcd1234" } });
    });

    test("aborting a wait over HTTP sets listening back to 0", async () => {
        const { url } = setup();
        const client = createApiClient(`${url}/rpc`);
        const controller = new AbortController();
        const waiting = client.actions
            .wait({ id: "abcd1234", timeoutMs: 5000 }, { signal: controller.signal })
            .catch((error: unknown) => error);
        await waitUntil(async () => (await client.actions.status({ id: "abcd1234" })).listening === 1);
        controller.abort();
        await waiting;
        await waitUntil(async () => (await client.actions.status({ id: "abcd1234" })).listening === 0);
    });

    test("calls onIdle after the idle time with no requests", async () => {
        let idle = false;
        setup(() => {
            idle = true;
        }, 50);
        await waitUntil(() => idle);
    });

    test("does not call onIdle while an events stream is open", async () => {
        let idle = false;
        const { url } = setup(() => {
            idle = true;
        }, 50);
        const stream = openStream(url);
        await waitUntil(() => has(stream, "status"));
        await Bun.sleep(200);
        expect(idle).toBe(false);
        await stream.close();
        await waitUntil(() => idle);
    });
});
