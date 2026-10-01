// Button clicks in the UI wait here until a `diff-digest wait` call takes them.
import type { Action, ActionStatus, WaitResult } from "../lib/schemas-api";

type Waiter = (result: WaitResult) => void;

export class ActionHub {
    readonly #queues = new Map<string, Action[]>();
    readonly #waiters = new Map<string, Waiter[]>();
    readonly #onStatus: (id: string, status: ActionStatus) => void;

    constructor(onStatus: (id: string, status: ActionStatus) => void) {
        this.#onStatus = onStatus;
    }

    status(id: string): ActionStatus {
        return { listening: this.#waiters.get(id)?.length ?? 0, queued: this.#queues.get(id)?.length ?? 0 };
    }

    /** The number of `wait` calls in progress, for the idle check. */
    get waiting(): number {
        let n = 0;
        for (const list of this.#waiters.values()) n += list.length;
        return n;
    }

    send(action: Action): ActionStatus {
        const waiter = this.#waiters.get(action.id)?.shift();
        if (waiter === undefined) this.#queues.set(action.id, [...(this.#queues.get(action.id) ?? []), action]);
        else waiter({ type: "action", action });
        return this.#changed(action.id);
    }

    /** Takes the next action, or waits for one. `onCancel` gets a function that stops the wait. */
    wait(id: string, timeoutMs: number, onCancel: (cancel: () => void) => void): Promise<WaitResult> {
        const queued = this.#queues.get(id)?.shift();
        if (queued !== undefined) {
            this.#changed(id);
            return Promise.resolve({ type: "action", action: queued });
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

    #remove(id: string, waiter: Waiter): void {
        const list = this.#waiters.get(id) ?? [];
        if (!list.includes(waiter)) return;
        this.#waiters.set(
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
