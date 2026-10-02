// The HTTP server: the RPC handler, the safety checks, change polling, and the idle timer (spec §4).
import { statSync } from "node:fs";
import { RPCHandler } from "@orpc/server/fetch";
import page from "../app/index.html";
import { listDigests, registryPath } from "../lib/registry";
import type { RegistryEntry } from "../lib/schemas-api";
import { commentsPath } from "../lib/store";
import { VERSION } from "../lib/version";
import { createServerContext } from "./context";
import { router } from "./router";

export const POLL_MS = 400;
export const IDLE_MS = 4 * 60 * 60 * 1000;
const IDLE_CHECK_MS = 60_000;

export interface ServerOptions {
    readonly port: number;
    readonly home: string;
    /** Called when the server has had no requests, streams, or waits for `idleMs`. */
    readonly onIdle: () => void;
    readonly idleMs?: number;
    /** `server run --dev`: Bun bundles the page on each load, with hot reload. */
    readonly development?: boolean;
}

export interface RunningServer {
    readonly port: number;
    readonly stop: () => Promise<void>;
}

/** Only this server's own origin may call it (no DNS rebinding, no cross-site calls). */
export function isAllowed(host: string | null, origin: string | null, port: number): boolean {
    const own = `127.0.0.1:${port}`;
    return host === own && (origin === null || origin === `http://${own}`);
}

function mtime(path: string): number {
    try {
        return statSync(path).mtimeMs;
    } catch {
        return 0;
    }
}

export interface PollOptions {
    /** When the digest got an open event stream (ms), or null. Only those digests are polled. */
    readonly watchedSince: (id: string) => number | null;
    readonly publish: (id: string, type: "digest" | "comments") => void;
    /** Gets each new error message once. The default writes one line to stderr. */
    readonly onError?: (message: string) => void;
}

function logError(message: string): void {
    process.stderr.write(`diff-digest server: ${message.replaceAll("\n", " ")}\n`);
}

/**
 * Publishes a `digest` or `comments` event when a file of a watched digest changes. An error in a
 * tick does not stop the polling: the last good digest list stays in use. Returns a stop function.
 */
export function pollChanges(home: string, options: PollOptions): () => void {
    let seen = new Map<string, number>();
    let entries: readonly RegistryEntry[] = [];
    let lastError: string | null = null;
    const tick = (): void => {
        entries = listDigests(registryPath(home));
        lastError = null;
    };
    const timer = setInterval(() => {
        try {
            tick();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== lastError) (options.onError ?? logError)(message);
            lastError = message;
        }
        const next = new Map<string, number>();
        for (const entry of entries) {
            const since = options.watchedSince(entry.id);
            if (since === null) continue;
            for (const [file, type] of [
                [entry.mdPath, "digest"],
                [commentsPath(entry.mdPath), "comments"],
            ] as const) {
                const now = mtime(file);
                const before = seen.get(file);
                next.set(file, now);
                // The first look at a file counts a change made after the stream opened.
                const changed = before === undefined ? now >= since : before !== now;
                if (changed) options.publish(entry.id, type);
            }
        }
        seen = next;
    }, POLL_MS);
    return () => {
        clearInterval(timer);
    };
}

export function startServer(options: ServerOptions): RunningServer {
    const context = createServerContext(options.home);
    const handler = new RPCHandler(router);
    let lastRequest = Date.now();
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: options.port,
        // Long-poll waits and event streams stay open, so the server must not close idle connections.
        idleTimeout: 0,
        // The page and its `/_bun/` assets carry no data, so they are not behind the Host check.
        routes: { "/d/:id/": page },
        development: options.development === true ? { hmr: true } : false,
        async fetch(request) {
            lastRequest = Date.now();
            if (!isAllowed(request.headers.get("host"), request.headers.get("origin"), server.port ?? 0)) {
                return new Response("forbidden", { status: 403 });
            }
            const url = new URL(request.url);
            if (url.pathname.startsWith("/rpc/")) {
                const { matched, response } = await handler.handle(request, { prefix: "/rpc", context });
                if (matched) return response;
            }
            if (url.pathname === "/health") return Response.json({ version: VERSION, pid: process.pid });
            return new Response("not found", { status: 404 });
        },
    });
    const stopPolling = pollChanges(options.home, {
        watchedSince: id => context.bus.watchedSince(id),
        publish: (id, type) => {
            context.bus.publish(id, { type });
        },
    });
    const idle = setInterval(
        () => {
            const quiet = Date.now() - lastRequest > (options.idleMs ?? IDLE_MS);
            if (quiet && context.bus.subscribers === 0 && context.actions.waiting === 0) options.onIdle();
        },
        Math.min(IDLE_CHECK_MS, options.idleMs ?? IDLE_MS),
    );
    return {
        port: server.port ?? 0,
        stop: async () => {
            stopPolling();
            clearInterval(idle);
            await server.stop(true);
        },
    };
}
