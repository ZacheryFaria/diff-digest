import { homedir } from "node:os";
import { join } from "node:path";

/** The tool's home folder. `DIFF_DIGEST_HOME` moves it, for example for tests. */
export function homeDir(): string {
    return process.env["DIFF_DIGEST_HOME"] ?? join(homedir(), ".diff-digest");
}

export function configPath(home: string = homeDir()): string {
    return join(home, "config.json");
}

export function storeDir(home: string = homeDir()): string {
    return join(home, "store");
}

export function expandHome(path: string): string {
    return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}
