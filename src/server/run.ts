// `server run`: the server process itself. It writes server.json and removes it when it stops.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ServerInfo } from "../lib/schemas-api";
import { writeAtomic } from "../lib/store";
import { VERSION } from "../lib/version";
import { startServer, type RunningServer, type ServerOptions } from "./http";
import { readServerInfo, serverInfoPath } from "./lifecycle";

/** The last port, so a restarted server keeps its URL and an open page can reconnect. */
export function lastPortPath(home: string): string {
    return join(home, "server.port");
}

function lastPort(home: string): number | null {
    try {
        const port = Number(readFileSync(lastPortPath(home), "utf8").trim());
        return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
    } catch {
        return null;
    }
}

/** With no port asked for, try the last port first; when another process has it, take a free port. */
function startOnPort(options: ServerOptions): RunningServer {
    const last = options.port === 0 ? lastPort(options.home) : null;
    if (last !== null) {
        try {
            return startServer({ ...options, port: last });
        } catch {
            // The last port is in use. Take a free port.
        }
    }
    return startServer(options);
}

/** Starts the server, writes server.json, and returns what it wrote. */
export function runServer(home: string, port = 0): ServerInfo {
    const stop = (): void => {
        // A newer server can own server.json now. Remove it only when it still names this process.
        if (readServerInfo(home)?.pid === process.pid) rmSync(serverInfoPath(home), { force: true });
        void server.stop().finally(() => process.exit(0));
    };
    const server = startOnPort({ port, home, onIdle: stop });
    writeAtomic(lastPortPath(home), `${server.port}\n`);
    const info = { pid: process.pid, port: server.port, version: VERSION, startedAt: new Date().toISOString() };
    writeAtomic(serverInfoPath(home), `${JSON.stringify(info, null, 2)}\n`);
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    return info;
}
