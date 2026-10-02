// How this CLI starts its own server process, and how it talks to the running one.
import { ORPCError } from "@orpc/client";
import { createApiClient, type ApiClient } from "../lib/client";
import { DigestError } from "../lib/errors";
import { isHealthy, readServerInfo } from "../server/lifecycle";

/** `[execPath, "server", "run"]` in the compiled binary; `[execPath, entry, "server", "run"]` from source. */
export function selfCommand(): readonly string[] {
    const compiled = Bun.main.startsWith("/$bunfs/");
    return compiled ? [process.execPath, "server", "run"] : [process.execPath, Bun.main, "server", "run"];
}

export function digestUrl(port: number, id: string): string {
    return `http://127.0.0.1:${port}/d/${id}/`;
}

export function rpcUrl(port: number): string {
    return `http://127.0.0.1:${port}/rpc`;
}

const SERVER_DOWN_HINT = "Run `diff-digest serve`.";

/** A client for the running server. SERVER_DOWN when no server answers /health. */
export async function runningApi(home: string): Promise<ApiClient> {
    const info = readServerInfo(home);
    if (info === null || !(await isHealthy(info)))
        throw new DigestError("SERVER_DOWN", "The review server is not running.", { hint: SERVER_DOWN_HINT });
    return createApiClient(rpcUrl(info.port));
}

/**
 * The result of a call to the running server. An error with no oRPC code is a transport error
 * (the server stopped, or the socket closed): it becomes SERVER_DOWN.
 */
export async function serverCall<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    } catch (error) {
        if (error instanceof ORPCError || error instanceof DigestError) throw error;
        throw new DigestError("SERVER_DOWN", `The review server did not answer: ${String(error)}`, {
            hint: SERVER_DOWN_HINT,
            cause: error,
        });
    }
}
