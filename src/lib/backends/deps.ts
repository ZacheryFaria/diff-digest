// The real outside world for backends: processes and files.
import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "../store";
import type { BackendDeps } from "./types";

export const realDeps: BackendDeps = {
    exec: (command, args, options) => {
        try {
            const result = Bun.spawnSync([command, ...args], {
                cwd: options.cwd,
                env: { ...process.env, ...options.env },
                stdin: options.input === undefined ? "ignore" : Buffer.from(options.input),
                stdout: "pipe",
                stderr: "pipe",
            });
            return { ok: result.exitCode === 0, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
        } catch (error) {
            // For example, the command is not installed.
            return { ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
        }
    },
    readFile: path => (existsSync(path) ? readFileSync(path, "utf8") : null),
    writeFile: (path, data) => {
        writeAtomic(path, data);
    },
};
