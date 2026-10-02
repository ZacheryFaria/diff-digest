// `server logs [-f]`: the last lines of the server log, and then (with -f) each new line until Ctrl-C.
import { existsSync, readFileSync, statSync } from "node:fs";
import { DigestError } from "../../lib/errors";
import { serverLogPath } from "../../server/lifecycle";
import type { CliContext } from "../context";
import { followLog } from "../follow";
import { emit } from "../output";
import { TextOutputSchema } from "../outputs";
import { LOG_LINES, type JsonFlags } from "./shared";

function untilInterrupt(): Promise<void> {
    return new Promise(resolve => {
        process.once("SIGINT", () => {
            resolve();
        });
    });
}

export interface LogsFlags extends JsonFlags {
    readonly follow: boolean;
}

export async function serverLogs(this: CliContext, flags: LogsFlags): Promise<void> {
    const path = serverLogPath(this.home);
    const end = existsSync(path) ? statSync(path).size : 0;
    await emit(this.out, { json: flags.json, schema: TextOutputSchema, text: t => t }, () => {
        if (flags.json && flags.follow)
            throw new DigestError("BAD_INPUT", "--follow prints lines as they come, so it does not work with --json.");
        if (!existsSync(path)) return "";
        return readFileSync(path, "utf8").split("\n").slice(-LOG_LINES).join("\n");
    });
    if (!flags.follow || flags.json) return;
    await followLog(
        path,
        end,
        line => {
            this.out.print(line);
        },
        untilInterrupt,
    );
}
