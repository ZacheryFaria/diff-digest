// `server run | status | stop | restart | logs`: the background server, managed by the CLI (spec §4).
import { existsSync, readFileSync } from "node:fs";
import { buildCommand, buildRouteMap } from "@stricli/core";
import { listDigests, registryPath } from "../../lib/registry";
import { ensureServer, isHealthy, readServerInfo, serverLogPath, stopServer } from "../../server/lifecycle";
import { runServer } from "../../server/run";
import type { CliContext } from "../context";
import { emit, jsonFlag } from "../output";
import { ServerStatusOutputSchema, StopOutputSchema, TextOutputSchema } from "../outputs";
import { selfCommand } from "../self";
import type { JsonFlags } from "./shared";

const LOG_LINES = 200;

const run = buildCommand({
    docs: { brief: "Run the server in the foreground (`serve` starts it in the background)" },
    parameters: {
        flags: { port: { kind: "parsed", parse: Number, brief: "The port (0: any free port)", default: "0" } },
    },
    func(this: CliContext, flags: { readonly port: number }) {
        runServer(this.home, flags.port);
    },
});

const status = buildCommand({
    docs: { brief: "Show the server pid, port, version, and the registered digests" },
    parameters: { flags: { json: jsonFlag } },
    async func(this: CliContext, flags: JsonFlags) {
        await emit(
            this.out,
            { json: flags.json, schema: ServerStatusOutputSchema, text: s => JSON.stringify(s, null, 2) },
            async () => {
                const info = readServerInfo(this.home);
                const running = info !== null && (await isHealthy(info));
                return { running, info: running ? info : null, digests: listDigests(registryPath(this.home)) };
            },
        );
    },
});

const stop = buildCommand({
    docs: { brief: "Stop the server" },
    parameters: { flags: { json: jsonFlag } },
    async func(this: CliContext, flags: JsonFlags) {
        await emit(this.out, { json: flags.json, schema: StopOutputSchema, text: r => r.result }, async () => ({
            result: await stopServer(this.home),
        }));
    },
});

const restart = buildCommand({
    docs: { brief: "Stop the server and start a new one" },
    parameters: { flags: { json: jsonFlag } },
    async func(this: CliContext, flags: JsonFlags) {
        await emit(
            this.out,
            { json: flags.json, schema: ServerStatusOutputSchema, text: s => JSON.stringify(s, null, 2) },
            async () => {
                await stopServer(this.home);
                const info = await ensureServer(selfCommand(), this.home);
                return { running: true, info, digests: listDigests(registryPath(this.home)) };
            },
        );
    },
});

const logs = buildCommand({
    docs: { brief: `Print the last ${LOG_LINES} lines of the server log` },
    parameters: { flags: { json: jsonFlag } },
    async func(this: CliContext, flags: JsonFlags) {
        await emit(this.out, { json: flags.json, schema: TextOutputSchema, text: t => t }, () => {
            const path = serverLogPath(this.home);
            if (!existsSync(path)) return "";
            return readFileSync(path, "utf8").split("\n").slice(-LOG_LINES).join("\n");
        });
    },
});

export const serverRoutes = buildRouteMap({
    docs: { brief: "Manage the background review server" },
    routes: { run, status, stop, restart, logs },
});
