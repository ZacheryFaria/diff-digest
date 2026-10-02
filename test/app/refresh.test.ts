import { describe, expect, test } from "bun:test";
import { latestOnly, trailing, type Timers, trackedTimers } from "../../src/app/state/refresh";

/** Timers that run when the test says so. */
function fakeTimers(): Timers<number> & { readonly advance: (ms: number) => void } {
    let now = 0;
    let next = 1;
    const due = new Map<number, { readonly at: number; readonly run: () => void }>();
    return {
        set: (run, ms) => {
            const handle = next;
            next += 1;
            due.set(handle, { at: now + ms, run });
            return handle;
        },
        clear: handle => {
            due.delete(handle);
        },
        advance: ms => {
            now += ms;
            for (const [handle, timer] of [...due.entries()].filter(([, t]) => t.at <= now)) {
                due.delete(handle);
                timer.run();
            }
        },
    };
}

function counter(): { readonly run: () => void; readonly runs: () => number } {
    let runs = 0;
    return {
        run: () => {
            runs += 1;
        },
        runs: () => runs,
    };
}

async function settle(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<null>();
    setTimeout(() => {
        resolve(null);
    }, 0);
    await promise;
}

describe("trailing", () => {
    test("runs once, after the last call of a burst", () => {
        const timers = fakeTimers();
        const count = counter();
        const call = trailing(count.run, 120, timers);
        call();
        timers.advance(100);
        call();
        timers.advance(100);
        expect(count.runs()).toBe(0);
        timers.advance(20);
        expect(count.runs()).toBe(1);
    });

    test("does not drop a second change that comes after the wait", () => {
        const timers = fakeTimers();
        const count = counter();
        const call = trailing(count.run, 120, timers);
        call();
        timers.advance(120);
        call();
        timers.advance(120);
        expect(count.runs()).toBe(2);
    });
});

describe("trackedTimers", () => {
    test("clearAll cancels the fetches that still wait", () => {
        const timers = fakeTimers();
        const tracked = trackedTimers(timers);
        const count = counter();
        const call = trailing(count.run, 120, tracked);
        call();
        tracked.clearAll();
        timers.advance(200);
        expect(count.runs()).toBe(0);
        call();
        timers.advance(120);
        expect(count.runs()).toBe(1);
    });
});

describe("latestOnly", () => {
    test("ignores a response that is older than the last request", async () => {
        const seen: string[] = [];
        const load = latestOnly<string>(
            v => {
                seen.push(v);
            },
            () => {
                seen.push("error");
            },
        );
        const old = Promise.withResolvers<string>();
        load(() => old.promise);
        load(async () => {
            await settle();
            return "new";
        });
        await settle();
        await settle();
        old.resolve("old");
        await settle();
        expect(seen).toEqual(["new"]);
    });

    test("reports a failure of the last request only", async () => {
        const errors: string[] = [];
        const load = latestOnly<string>(
            () => {
                errors.push("value");
            },
            e => {
                errors.push(e instanceof Error ? e.message : "");
            },
        );
        load(async () => {
            await settle();
            throw new Error("old");
        });
        load(async () => {
            await settle();
            throw new Error("new");
        });
        await settle();
        await settle();
        expect(errors).toEqual(["new"]);
    });
});
