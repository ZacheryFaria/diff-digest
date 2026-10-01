// `server run`: the server process itself. It writes server.json and removes it when it stops.
import { rmSync } from "node:fs";
import { writeAtomic } from "../lib/store";
import { VERSION } from "../lib/version";
import { startServer } from "./http";
import { serverInfoPath } from "./lifecycle";

export function runServer(home: string, port = 0): void {
    const stop = (): void => {
        rmSync(serverInfoPath(home), { force: true });
        void server.stop().finally(() => process.exit(0));
    };
    const server = startServer({ port, home, onIdle: stop });
    const info = { pid: process.pid, port: server.port, version: VERSION, startedAt: new Date().toISOString() };
    writeAtomic(serverInfoPath(home), `${JSON.stringify(info, null, 2)}\n`);
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
}
