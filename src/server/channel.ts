// A push-based async iterator for oRPC event streams.

/** `push` adds a value, `close` ends it. `onClose` runs once at the end. */
export class Channel<T> implements AsyncIterableIterator<T, undefined> {
    readonly #items: T[] = [];
    #pending: PromiseWithResolvers<IteratorResult<T, undefined>> | undefined;
    #closed = false;
    readonly #onClose: () => void;

    constructor(onClose: () => void) {
        this.#onClose = onClose;
    }

    push(item: T): void {
        if (this.#closed) return;
        const pending = this.#pending;
        this.#pending = undefined;
        if (pending === undefined) this.#items.push(item);
        else pending.resolve({ value: item, done: false });
    }

    close(): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#onClose();
        this.#pending?.resolve({ value: undefined, done: true });
        this.#pending = undefined;
    }

    next(): Promise<IteratorResult<T, undefined>> {
        const item = this.#items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        const pending = Promise.withResolvers<IteratorResult<T, undefined>>();
        this.#pending = pending;
        return pending.promise;
    }

    return(): Promise<IteratorResult<T, undefined>> {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
    }

    [Symbol.asyncIterator](): this {
        return this;
    }
}
