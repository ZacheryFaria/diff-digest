// The digest, the comments, and the listener status, kept fresh by the server's event stream.
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../lib/client";
import type { Comment } from "../../lib/schemas";
import type { ActionStatus, DigestPayload } from "../../lib/schemas-api";

/** One change can give two events of the same type (the procedure and the poller); drop the second. */
export const DEDUPE_MS = 100;
const RETRY_MS = 2000;

export interface Live {
    readonly payload: DigestPayload | null;
    readonly comments: readonly Comment[];
    readonly status: ActionStatus | null;
    readonly offline: boolean;
    readonly error: string | null;
    readonly reloadComments: () => void;
}

interface Setters {
    readonly payload: (p: DigestPayload) => void;
    readonly comments: (c: readonly Comment[]) => void;
    readonly error: (e: string) => void;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function fetchDigest(api: ApiClient, id: string, set: Setters): void {
    api.digest.get({ id }).then(set.payload, (e: unknown) => {
        set.error(message(e));
    });
}

function fetchComments(api: ApiClient, id: string, set: Setters): void {
    api.comments.list({ id }).then(set.comments, (e: unknown) => {
        set.error(message(e));
    });
}

interface Handlers extends Setters {
    readonly status: (s: ActionStatus) => void;
    readonly offline: (offline: boolean) => void;
}

/**
 * Fetch the digest and the comments, then follow the event stream. A dropped stream retries; when it is
 * back, fetch both again (events can be lost while offline). Returns a stop function.
 */
function subscribe(api: ApiClient, id: string, on: Handlers): () => void {
    const stop = new AbortController();
    const last = { digest: 0, comments: 0 };
    const listen = async (): Promise<void> => {
        const stream = await api.events({ id }, { signal: stop.signal });
        on.offline(false);
        for await (const event of stream) {
            if (event.type === "status") {
                on.status(event.status);
                continue;
            }
            const now = Date.now();
            if (now - last[event.type] < DEDUPE_MS) continue;
            last[event.type] = now;
            if (event.type === "digest") fetchDigest(api, id, on);
            else fetchComments(api, id, on);
        }
    };
    const connect = (): void => {
        fetchDigest(api, id, on);
        fetchComments(api, id, on);
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
    return () => {
        stop.abort();
    };
}

export function useLive(api: ApiClient, id: string): Live {
    const [payload, setPayload] = useState<DigestPayload | null>(null);
    const [comments, setComments] = useState<readonly Comment[]>([]);
    const [status, setStatus] = useState<ActionStatus | null>(null);
    const [offline, setOffline] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reloadComments = useCallback(() => {
        fetchComments(api, id, { payload: setPayload, comments: setComments, error: setError });
    }, [api, id]);
    useEffect(
        () =>
            subscribe(api, id, {
                payload: setPayload,
                comments: setComments,
                error: setError,
                status: setStatus,
                offline: setOffline,
            }),
        [api, id],
    );
    return { payload, comments, status, offline, error, reloadComments };
}
