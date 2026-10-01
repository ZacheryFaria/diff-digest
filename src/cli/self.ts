// How this CLI starts its own server process, and how it talks to the running one.
import { createApiClient, type ApiClient } from "../lib/client";
import { DigestError } from "../lib/errors";
import { readServerInfo } from "../server/lifecycle";

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

/** A client for the running server. SERVER_DOWN when no server is running. */
export function runningApi(home: string): ApiClient {
    const info = readServerInfo(home);
    if (info === null)
        throw new DigestError("SERVER_DOWN", "The review server is not running.", { hint: "Run `diff-digest serve`." });
    return createApiClient(rpcUrl(info.port));
}
