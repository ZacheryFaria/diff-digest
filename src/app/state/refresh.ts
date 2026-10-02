// Fetch timing for the live page. Pure: the timers come in as a parameter, so the tests can run them.

export interface Timers<H> {
    readonly set: (run: () => void, ms: number) => H;
    readonly clear: (handle: H) => void;
}

/**
 * Runs `run` once, `ms` after the last call. One change can give two or three events (the procedure, the
 * poller, and the writer's own reload); they give one fetch. A later change gives a later fetch.
 */
export function trailing<H>(run: () => void, ms: number, timers: Timers<H>): () => void {
    let pending: { readonly handle: H } | null = null;
    return () => {
        if (pending !== null) timers.clear(pending.handle);
        pending = {
            handle: timers.set(() => {
                pending = null;
                run();
            }, ms),
        };
    };
}

/** Starts a load each call, and keeps only the result of the last one (responses can come out of order). */
export function latestOnly<T>(
    apply: (value: T) => void,
    fail: (error: unknown) => void,
): (load: () => Promise<T>) => void {
    let last = 0;
    return load => {
        last += 1;
        const mine = last;
        load().then(
            value => {
                if (mine === last) apply(value);
                return null;
            },
            (error: unknown) => {
                if (mine === last) fail(error);
                return null;
            },
        );
    };
}
