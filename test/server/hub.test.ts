import { describe, expect, test } from "bun:test";
import type { Action } from "../../src/lib/schemas-api";
import { ACTION_TTL_MS, ActionHub } from "../../src/server/actions";
import { EventBus } from "../../src/server/bus";

function noop(): void {
    // The tests do not check the status events.
}

const ACTION: Action = { type: "apply", id: "abcd1234", mdPath: "/x/main.md", comments: [] };

describe("ActionHub", () => {
    test("a queued action expires after the time to live", async () => {
        let now = 0;
        const hub = new ActionHub(noop, { now: () => now });
        hub.send(ACTION);
        now = ACTION_TTL_MS - 1;
        expect(await hub.wait("abcd1234", 10, noop)).toEqual({ type: "action", action: ACTION });
        hub.send(ACTION);
        now += ACTION_TTL_MS + 1;
        expect(await hub.wait("abcd1234", 10, noop)).toEqual({ type: "timeout" });
        expect(hub.status("abcd1234")).toEqual({ listening: 0, queued: 0 });
    });
});

describe("EventBus", () => {
    test("has() is true only while the id has a listener", () => {
        const bus = new EventBus();
        expect(bus.has("abcd1234")).toBe(false);
        const off = bus.subscribe("abcd1234", noop);
        expect(bus.has("abcd1234")).toBe(true);
        off();
        expect(bus.has("abcd1234")).toBe(false);
        expect(bus.subscribers).toBe(0);
    });
});
