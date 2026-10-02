// `server run`: the server process itself. It writes server.json and removes it when it stops.
import { rmSync } from "node:fs";
import type { ServerInfo } from "../lib/schemas-api";
import { writeAtomic } from "../lib/store";
import { VERSION } from "../lib/version";
import { startServer } from "./http";
import { readServerInfo, serverInfoPath } from "./lifecycle";

/** Starts the server, writes server.json, and returns what it wrote. */
export function runServer(home: string, port = 0): ServerInfo {
    const stop = (): void => {
        // A newer server can own server.json now. Remove it only when it still names this process.
        if (readServerInfo(home)?.pid === process.pid) rmSync(serverInfoPath(home), { force: true });
        void server.stop().finally(() => process.exit(0));
    };
    const server = startServer({ port, home, onIdle: stop });
    const info = { pid: process.pid, port: server.port, version: VERSION, startedAt: new Date().toISOString() };
    writeAtomic(serverInfoPath(home), `${JSON.stringify(info, null, 2)}\n`);
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    return info;
}
