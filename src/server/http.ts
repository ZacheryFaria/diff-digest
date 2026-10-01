// The HTTP server: the RPC handler, the safety checks, change polling, and the idle timer (spec §4).
import { statSync } from "node:fs";
import { RPCHandler } from "@orpc/server/fetch";
import { listDigests, registryPath } from "../lib/registry";
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
}

export interface RunningServer {
    readonly port: number;
    readonly stop: () => Promise<void>;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>diff-digest</title>
<p>The diff-digest server is running. The review UI is not built yet.</p>`;

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

/** Publishes a `digest` or `comments` event when a registered file changes. Returns a stop function. */
export function pollChanges(home: string, publish: (id: string, type: "digest" | "comments") => void): () => void {
    const seen = new Map<string, number>();
    const timer = setInterval(() => {
        for (const entry of listDigests(registryPath(home))) {
            for (const [file, type] of [
                [entry.mdPath, "digest"],
                [commentsPath(entry.mdPath), "comments"],
            ] as const) {
                const now = mtime(file);
                const before = seen.get(file);
                seen.set(file, now);
                if (before !== undefined && before !== now) publish(entry.id, type);
            }
        }
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
            if (/^\/d\/[0-9a-z]{8}\/$/u.test(url.pathname))
                return new Response(PAGE, { headers: { "content-type": "text/html" } });
            return new Response("not found", { status: 404 });
        },
    });
    const stopPolling = pollChanges(options.home, (id, type) => {
        context.bus.publish(id, { type });
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
