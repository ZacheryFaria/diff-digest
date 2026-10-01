// Prints a command's result as JSON or text, after it is checked against the command's output schema.
import { ORPCError } from "@orpc/client";
import { z } from "zod";
import { DigestError, ERROR_CODES, EXIT_CODES, type ErrorCode } from "../lib/errors";
import type { Output } from "./context";

/** The part of a zod schema that `emit` uses (a readonly view, so options stay readonly). */
export interface Parser<T> {
    readonly parse: (value: unknown) => T;
}

export interface EmitOptions<T> {
    readonly json: boolean;
    readonly schema: Parser<T>;
    /** The text form of the result (used without `--json`). */
    readonly text: (data: T) => string;
    /** A non-zero exit code for a result that is a failure (for example lint errors). */
    readonly exitCode?: (data: T) => number;
}

function isErrorCode(value: string): value is ErrorCode {
    return ERROR_CODES.some(c => c === value);
}

/** Any error as a DigestError. oRPC errors keep their code; input validation becomes BAD_INPUT. */
export function toDigestError(error: unknown): DigestError {
    if (error instanceof DigestError) return error;
    if (error instanceof ORPCError) {
        const raw: unknown = error.code;
        const name = typeof raw === "string" ? raw : "";
        const code = isErrorCode(name) ? name : name === "BAD_REQUEST" ? "BAD_INPUT" : "INTERNAL";
        const data: unknown = error.data;
        const parsed = z.looseObject({ hint: z.string().optional() }).safeParse(data);
        const hint = parsed.success ? parsed.data.hint : undefined;
        return new DigestError(code, error.message, { cause: error, ...(hint === undefined ? {} : { hint }) });
    }
    if (error instanceof z.ZodError) {
        return new DigestError("INTERNAL", `The command result does not match its schema:\n${z.prettifyError(error)}`);
    }
    return new DigestError("INTERNAL", error instanceof Error ? error.message : String(error), { cause: error });
}

export async function emit<T>(out: Output, options: EmitOptions<T>, run: () => T | Promise<T>): Promise<void> {
    try {
        const data = options.schema.parse(await run());
        out.print(options.json ? JSON.stringify({ ok: true, data }, null, 2) : options.text(data));
        const code = options.exitCode?.(data) ?? 0;
        if (code !== 0) out.setExitCode(code);
    } catch (error) {
        const failure = toDigestError(error);
        if (options.json) out.print(JSON.stringify({ ok: false, error: failure.toJSON() }, null, 2));
        else
            out.printError(
                `diff-digest: ${failure.message}${failure.hint === undefined ? "" : `\nHint: ${failure.hint}`}`,
            );
        out.setExitCode(EXIT_CODES[failure.code]);
    }
}

/** The `--json` flag that every command that prints data has. */
export const jsonFlag = { kind: "boolean", brief: "Print the result as JSON", default: false } as const;
