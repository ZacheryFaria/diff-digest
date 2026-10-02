// `server run | status | stop | restart | logs`: the background server (spec §4). Each loads its code when it runs.
import { buildCommand, buildRouteMap } from "@stricli/core";
import { jsonFlag, LOG_LINES, parsePort } from "../commands/shared";

const jsonOnly = { flags: { json: jsonFlag } } as const;

export const serverRoutes = buildRouteMap({
    docs: { brief: "Manage the background review server" },
    routes: {
        run: buildCommand({
            docs: { brief: "Run the server in the foreground (`serve` starts it in the background)" },
            parameters: {
                flags: {
                    port: { kind: "parsed", parse: parsePort, brief: "The port (0: any free port)", default: "0" },
                },
            },
            loader: async () => (await import("../commands/server")).serverRun,
        }),
        status: buildCommand({
            docs: { brief: "Show the server pid, port, version, and the registered digests" },
            parameters: jsonOnly,
            loader: async () => (await import("../commands/server")).serverStatus,
        }),
        stop: buildCommand({
            docs: { brief: "Stop the server" },
            parameters: jsonOnly,
            loader: async () => (await import("../commands/server")).serverStop,
        }),
        restart: buildCommand({
            docs: { brief: "Stop the server and start a new one" },
            parameters: jsonOnly,
            loader: async () => (await import("../commands/server")).serverRestart,
        }),
        logs: buildCommand({
            docs: { brief: `Print the last ${LOG_LINES} lines of the server log` },
            parameters: jsonOnly,
            loader: async () => (await import("../commands/server")).serverLogs,
        }),
    },
});
