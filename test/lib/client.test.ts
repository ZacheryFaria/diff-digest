import { afterEach, describe, expect, test } from "bun:test";
import { createApiClient } from "../../src/lib/client";

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

/** Records the init of each fetch and answers like a server with no such procedure. */
function recordFetch(): { readonly inits: unknown[] } {
    const inits: unknown[] = [];
    const fake = (_input: unknown, init?: unknown): Promise<Response> => {
        inits.push(init);
        return Promise.resolve(new Response("{}", { status: 404 }));
    };
    globalThis.fetch = Object.assign(fake, { preconnect: realFetch.preconnect });
    return { inits };
}

describe("createApiClient", () => {
    test("a long-poll client turns off Bun's request timeout (360 s), so wait can wait for hours", async () => {
        const seen = recordFetch();
        await createApiClient("http://127.0.0.1:1/rpc", { longPoll: true })
            .actions.status({ id: "abcd1234" })
            .catch(() => null);
        expect(seen.inits).toEqual([expect.objectContaining({ timeout: false })]);
    });
});
