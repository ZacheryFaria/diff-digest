// Server events for each digest id: the UI's live reload and the listener status.
import type { ServerEvent } from "../lib/schemas-api";

type Listener = (event: ServerEvent) => void;

export class EventBus {
    readonly #listeners = new Map<string, Set<Listener>>();

    /** Returns a function that removes the listener. */
    subscribe(id: string, listener: Listener): () => void {
        const set = this.#listeners.get(id) ?? new Set<Listener>();
        set.add(listener);
        this.#listeners.set(id, set);
        return () => {
            set.delete(listener);
            if (set.size === 0 && this.#listeners.get(id) === set) this.#listeners.delete(id);
        };
    }

    /** True when `id` has an open event stream now. Change polling skips the other digests. */
    has(id: string): boolean {
        return (this.#listeners.get(id)?.size ?? 0) > 0;
    }

    publish(id: string, event: ServerEvent): void {
        for (const listener of this.#listeners.get(id) ?? []) listener(event);
    }

    /** The number of open event streams, for the idle check. */
    get subscribers(): number {
        let n = 0;
        for (const set of this.#listeners.values()) n += set.size;
        return n;
    }
}
