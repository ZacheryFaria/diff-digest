// Button clicks in the UI wait here until a `diff-digest wait` call takes them.
import type { Action, ActionStatus, WaitResult } from "../lib/schemas-api";

type Waiter = (result: WaitResult) => void;

/** A queued action that no `wait` takes in this time is dropped. */
export const ACTION_TTL_MS = 10 * 60 * 1000;

interface Queued {
    readonly action: Action;
    readonly at: number;
}

export interface ActionHubOptions {
    /** The clock in ms (a function, so tests can move it). */
    readonly now?: () => number;
}

export class ActionHub {
    readonly #queues = new Map<string, readonly Queued[]>();
    readonly #waiters = new Map<string, readonly Waiter[]>();
    readonly #onStatus: (id: string, status: ActionStatus) => void;
    readonly #now: () => number;

    constructor(onStatus: (id: string, status: ActionStatus) => void, options: ActionHubOptions = {}) {
        this.#onStatus = onStatus;
        this.#now = options.now ?? Date.now;
    }

    status(id: string): ActionStatus {
        return { listening: this.#waiters.get(id)?.length ?? 0, queued: this.#fresh(id).length };
    }

    /** The number of `wait` calls in progress, for the idle check. */
    get waiting(): number {
        let n = 0;
        for (const list of this.#waiters.values()) n += list.length;
        return n;
    }

    send(action: Action): ActionStatus {
        const [waiter, ...others] = this.#waiters.get(action.id) ?? [];
        if (waiter === undefined) {
            this.#queues.set(action.id, [...this.#fresh(action.id), { action, at: this.#now() }]);
        } else {
            this.#setWaiters(action.id, others);
            waiter({ type: "action", action });
        }
        return this.#changed(action.id);
    }

    /** Takes the next action, or waits for one. `onCancel` gets a function that stops the wait. */
    wait(id: string, timeoutMs: number, onCancel: (cancel: () => void) => void): Promise<WaitResult> {
        const [queued, ...rest] = this.#fresh(id);
        if (queued !== undefined) {
            this.#setQueue(id, rest);
            this.#changed(id);
            return Promise.resolve({ type: "action", action: queued.action });
        }
        return new Promise(resolve => {
            const finish = (result: WaitResult): void => {
                clearTimeout(timer);
                this.#remove(id, waiter);
                resolve(result);
            };
            const waiter: Waiter = result => {
                finish(result);
            };
            const timer = setTimeout(() => {
                finish({ type: "timeout" });
            }, timeoutMs);
            this.#waiters.set(id, [...(this.#waiters.get(id) ?? []), waiter]);
            this.#changed(id);
            onCancel(() => {
                finish({ type: "timeout" });
            });
        });
    }

    /** The queue of `id` without the expired actions. Drops the expired ones. */
    #fresh(id: string): readonly Queued[] {
        const list = this.#queues.get(id) ?? [];
        const fresh = list.filter(q => this.#now() - q.at < ACTION_TTL_MS);
        if (fresh.length !== list.length) this.#setQueue(id, fresh);
        return fresh;
    }

    /** Sets the queue, and removes the entry when the queue is empty. */
    #setQueue(id: string, list: readonly Queued[]): void {
        if (list.length === 0) this.#queues.delete(id);
        else this.#queues.set(id, list);
    }

    /** Sets the waiters, and removes the entry when no waiter is left. */
    #setWaiters(id: string, list: readonly Waiter[]): void {
        if (list.length === 0) this.#waiters.delete(id);
        else this.#waiters.set(id, list);
    }

    #remove(id: string, waiter: Waiter): void {
        const list = this.#waiters.get(id) ?? [];
        if (!list.includes(waiter)) return;
        this.#setWaiters(
            id,
            list.filter(w => w !== waiter),
        );
        this.#changed(id);
    }

    #changed(id: string): ActionStatus {
        const status = this.status(id);
        this.#onStatus(id, status);
        return status;
    }
}
