// The digest, the comments, and the listener status, kept fresh by the server's event stream.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../lib/client";
import type { Comment } from "../../lib/schemas";
import type { ActionStatus, DigestPayload } from "../../lib/schemas-api";
import { latestOnly, trackedTimers, trailing, type Timers } from "./refresh";

/** One change can give two or three events of the same type; fetch once, this long after the last one. */
export const REFRESH_MS = 120;
const RETRY_MS = 2000;

const TIMERS: Timers<ReturnType<typeof setTimeout>> = {
    set: (run, ms) => setTimeout(run, ms),
    clear: handle => {
        clearTimeout(handle);
    },
};

export interface Live {
    readonly payload: DigestPayload | null;
    readonly comments: readonly Comment[];
    readonly status: ActionStatus | null;
    readonly offline: boolean;
    readonly error: string | null;
    readonly reloadComments: () => void;
}

interface Handlers {
    readonly payload: (p: DigestPayload) => void;
    readonly comments: (c: readonly Comment[]) => void;
    readonly error: (e: string) => void;
    readonly status: (s: ActionStatus) => void;
    readonly offline: (offline: boolean) => void;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface Loader {
    /** Fetch now (the first load, and after a reconnect). */
    readonly digestNow: () => void;
    readonly commentsNow: () => void;
    /** Fetch after a burst of events. */
    readonly digest: () => void;
    readonly comments: () => void;
    /** Cancel the fetches that wait for their delay. */
    readonly cancel: () => void;
}

function loader(api: ApiClient, id: string, on: Handlers): Loader {
    const fail = (e: unknown): void => {
        on.error(message(e));
    };
    const digest = latestOnly(on.payload, fail);
    const comments = latestOnly(on.comments, fail);
    const digestNow = (): void => {
        digest(() => api.digest.get({ id }));
    };
    const commentsNow = (): void => {
        comments(() => api.comments.list({ id }));
    };
    const timers = trackedTimers(TIMERS);
    return {
        digestNow,
        commentsNow,
        digest: trailing(digestNow, REFRESH_MS, timers),
        comments: trailing(commentsNow, REFRESH_MS, timers),
        cancel: timers.clearAll,
    };
}

interface Subscription {
    readonly stop: () => void;
    readonly reloadComments: () => void;
}

/**
 * Fetch the digest and the comments, then follow the event stream (when `follow`). A dropped stream retries;
 * when it is back, fetch both again (events can be lost while offline).
 */
function subscribe(api: ApiClient, id: string, on: Handlers, follow: boolean): Subscription {
    const stop = new AbortController();
    const load = loader(api, id, on);
    const listen = async (): Promise<void> => {
        const stream = await api.events({ id }, { signal: stop.signal });
        on.offline(false);
        for await (const event of stream) {
            if (event.type === "status") on.status(event.status);
            else if (event.type === "digest") load.digest();
            else load.comments();
        }
    };
    const connect = (): void => {
        load.digestNow();
        load.commentsNow();
        if (!follow) return;
        listen()
            .then(
                () => null,
                () => null,
            )
            .finally(() => {
                if (stop.signal.aborted) return;
                on.offline(true);
                setTimeout(() => {
                    if (!stop.signal.aborted) connect();
                }, RETRY_MS);
            });
    };
    connect();
    return {
        stop: () => {
            stop.abort();
            load.cancel();
        },
        // The writer's own reload is at once; the events of the same change come later and give one fetch.
        reloadComments: load.commentsNow,
    };
}

/** `follow` is false for `?live=0`: fetch once, with no event stream. */
export function useLive(api: ApiClient, id: string, follow: boolean): Live {
    const [payload, setPayload] = useState<DigestPayload | null>(null);
    const [comments, setComments] = useState<readonly Comment[]>([]);
    const [status, setStatus] = useState<ActionStatus | null>(null);
    const [offline, setOffline] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reload = useRef<(() => void) | null>(null);
    const reloadComments = useCallback(() => {
        reload.current?.();
    }, []);
    useEffect(() => {
        const handlers = {
            payload: setPayload,
            comments: setComments,
            error: setError,
            status: setStatus,
            offline: setOffline,
        };
        const subscription = subscribe(api, id, handlers, follow);
        reload.current = subscription.reloadComments;
        return subscription.stop;
    }, [api, id, follow]);
    return { payload, comments, status, offline, error, reloadComments };
}
