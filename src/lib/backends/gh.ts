// Calls to the `gh` CLI, with each JSON answer checked by a schema.
import { z } from "zod";
import { DigestError } from "../errors";
import type { BackendDeps } from "./types";

export interface GhCall {
    readonly host: string;
    readonly cwd: string;
    readonly args: readonly string[];
    readonly input?: string;
}

export function gh(deps: BackendDeps, call: GhCall): string {
    const result = deps.exec("gh", call.args, {
        cwd: call.cwd,
        env: { GH_HOST: call.host },
        ...(call.input === undefined ? {} : { input: call.input }),
    });
    if (!result.ok) {
        throw new DigestError(
            "BACKEND_FAILED",
            `gh ${call.args.slice(0, 3).join(" ")} failed: ${result.stderr.trim()}`,
            {
                hint: `Check \`gh auth status --hostname ${call.host}\`.`,
            },
        );
    }
    return result.stdout;
}

/** The part of a zod schema that `ghJson` uses (a readonly view). */
export interface Checker<T> {
    readonly safeParse: (value: unknown) => z.ZodSafeParseResult<T>;
}

export function ghJson<T>(deps: BackendDeps, call: GhCall, schema: Checker<T>): T {
    const text = gh(deps, call);
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new DigestError("BACKEND_FAILED", "gh did not return JSON.", { cause: error });
    }
    const result = schema.safeParse(raw);
    if (!result.success)
        throw new DigestError("BACKEND_FAILED", `gh returned an unexpected shape:\n${z.prettifyError(result.error)}`);
    return result.data;
}
