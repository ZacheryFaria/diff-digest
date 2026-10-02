import type { BackendDeps, ExecResult } from "../../src/lib/backends/types";

export interface FakeCall {
    readonly command: string;
    readonly args: readonly string[];
    readonly input: string | undefined;
}

/**
 * In-memory files and a scripted `exec`: `answer` gets each call and returns the result.
 * A gh call must have a GH_HOST and a cwd, as the real gh needs them.
 */
export function fakeDeps(answer: (call: FakeCall) => ExecResult = () => ({ ok: true, stdout: "", stderr: "" })): {
    readonly deps: BackendDeps;
    readonly files: Map<string, string>;
    readonly calls: FakeCall[];
} {
    const files = new Map<string, string>();
    const calls: FakeCall[] = [];
    const deps: BackendDeps = {
        exec: (command, args, options) => {
            if (command === "gh" && (options.env?.["GH_HOST"] === undefined || options.cwd === ""))
                throw new Error(`gh ${args.join(" ")}: no GH_HOST or no cwd`);
            const call = { command, args, input: options.input };
            calls.push(call);
            return answer(call);
        },
        readFile: path => files.get(path) ?? null,
        writeFile: (path, data) => {
            files.set(path, data);
        },
    };
    return { deps, files, calls };
}
