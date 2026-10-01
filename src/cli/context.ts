// The Stricli context for each command.
import type { CommandContext } from "@stricli/core";
import { homeDir } from "../lib/paths";

/** What commands use to write output. Commands take this, not the whole context. */
export interface Output {
    readonly print: (text: string) => void;
    readonly printError: (text: string) => void;
    readonly setExitCode: (code: number) => void;
}

export interface CliContext extends CommandContext {
    readonly out: Output;
    readonly cwd: string;
    readonly home: string;
}

export function buildContext(): CliContext {
    return {
        process,
        cwd: process.cwd(),
        home: homeDir(),
        out: {
            print: text => {
                process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
            },
            printError: text => {
                process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
            },
            setExitCode: code => {
                process.exitCode = code;
            },
        },
    };
}
