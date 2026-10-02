// Parameters that many commands share. The route files import this file at start, so it imports nothing heavy.

/** The `--json` flag that every command that prints data has. */
export const jsonFlag = { kind: "boolean", brief: "Print the result as JSON", default: false } as const;

/** The comment statuses that `comments --status` takes. */
export const COMMENT_STATUSES = ["open", "resolved", "note", "shared"] as const;

/** The lines that `server logs` prints. */
export const LOG_LINES = 200;

export const refPositional = {
    kind: "tuple",
    parameters: [
        {
            brief: "A branch, commit, range, PR (#123 or a URL), or digest .md path (default: the current branch)",
            parse: String,
            placeholder: "ref",
            optional: true,
        },
    ],
} as const;

export interface JsonFlags {
    readonly json: boolean;
}

export const idFlag = {
    kind: "parsed",
    parse: String,
    brief: "The digest id (instead of a ref)",
    optional: true,
} as const;

export interface RefFlags extends JsonFlags {
    readonly id?: string;
}

export const refFlag = {
    kind: "parsed",
    parse: String,
    brief: "A branch, commit, range, PR (#123 or a URL), or digest .md path",
    optional: true,
} as const;

export const baseFlag = {
    kind: "parsed",
    parse: String,
    brief: "The base ref (default: the target's base, for example the merge-base with the default branch)",
    optional: true,
} as const;

export interface BaseFlags extends JsonFlags {
    readonly base?: string;
}

/** A number of seconds: finite and not negative. A bad value is a usage error (exit 2). */
export function parseSeconds(text: string): number {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value) || value < 0) throw new Error(`Not a number of seconds: ${text}`);
    return value;
}

/** A TCP port: an integer from 0 (any free port) to 65535. A bad value is a usage error (exit 2). */
export function parsePort(text: string): number {
    const value = Number(text);
    if (text.trim() === "" || !Number.isInteger(value) || value < 0 || value > 65_535)
        throw new Error(`Not a port: ${text}`);
    return value;
}

/** A flag that takes a comma list (`--to github,notes`). */
export function listFlag(brief: string): {
    readonly kind: "parsed";
    readonly parse: StringConstructor;
    readonly brief: string;
    readonly optional: true;
} {
    return { kind: "parsed", parse: String, brief, optional: true };
}

export function splitList(value: string | undefined): string[] {
    return (value ?? "")
        .split(",")
        .map(v => v.trim())
        .filter(v => v !== "");
}
