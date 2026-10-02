// `server run | status | stop | restart | logs`: the background server, managed by the CLI (spec §4).
import { existsSync, readFileSync } from "node:fs";
import { listDigests, registryPath } from "../../lib/registry";
import { isHealthy, readServerInfo, serverLogPath, stopServer } from "../../server/lifecycle";
import { runServer } from "../../server/run";
import type { CliContext } from "../context";
import { emit } from "../output";
import { ServerStatusOutputSchema, StopOutputSchema, TextOutputSchema } from "../outputs";
import { restartServer } from "../self";
import { LOG_LINES, type JsonFlags } from "./shared";

export function serverRun(this: CliContext, flags: { readonly port: number }): void {
    const info = runServer(this.home, flags.port);
    // One start line, so that server.log shows each start.
    this.out.print(`diff-digest server ${info.version} pid ${info.pid} port ${info.port}`);
}

export async function serverStatus(this: CliContext, flags: JsonFlags): Promise<void> {
    await emit(
        this.out,
        { json: flags.json, schema: ServerStatusOutputSchema, text: s => JSON.stringify(s, null, 2) },
        async () => {
            const info = readServerInfo(this.home);
            const running = info !== null && (await isHealthy(info));
            return { running, info: running ? info : null, digests: listDigests(registryPath(this.home)) };
        },
    );
}

export async function serverStop(this: CliContext, flags: JsonFlags): Promise<void> {
    await emit(this.out, { json: flags.json, schema: StopOutputSchema, text: r => r.result }, async () => ({
        result: await stopServer(this.home),
    }));
}

export async function serverRestart(this: CliContext, flags: JsonFlags): Promise<void> {
    await emit(
        this.out,
        { json: flags.json, schema: ServerStatusOutputSchema, text: s => JSON.stringify(s, null, 2) },
        async () => {
            const info = await restartServer(this.home);
            return { running: true, info, digests: listDigests(registryPath(this.home)) };
        },
    );
}

export async function serverLogs(this: CliContext, flags: JsonFlags): Promise<void> {
    await emit(this.out, { json: flags.json, schema: TextOutputSchema, text: t => t }, () => {
        const path = serverLogPath(this.home);
        if (!existsSync(path)) return "";
        return readFileSync(path, "utf8").split("\n").slice(-LOG_LINES).join("\n");
    });
}
