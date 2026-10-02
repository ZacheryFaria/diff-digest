// `target`, `path`, `init`: what a digest describes and where its working copy is.
import { existsSync } from "node:fs";
import type { CliContext } from "../context";
import { initWorkingCopy } from "../init";
import { emit } from "../output";
import { InitOutputSchema, PathOutputSchema } from "../outputs";
import { workingCopyFor } from "../ref";
import { TargetSchema } from "../target";
import type { BaseFlags, JsonFlags } from "./shared";

export async function target(this: CliContext, flags: JsonFlags, ref?: string): Promise<void> {
    await emit(
        this.out,
        { json: flags.json, schema: TargetSchema, text: t => JSON.stringify(t, null, 2) },
        () => workingCopyFor(ref, this).target,
    );
}

export async function path(this: CliContext, flags: JsonFlags, ref?: string): Promise<void> {
    await emit(this.out, { json: flags.json, schema: PathOutputSchema, text: p => p.path }, () => {
        const { mdPath } = workingCopyFor(ref, this);
        return { path: mdPath, exists: existsSync(mdPath) };
    });
}

export async function init(this: CliContext, flags: BaseFlags, ref?: string): Promise<void> {
    await emit(this.out, { json: flags.json, schema: InitOutputSchema, text: r => r.path }, () => {
        const result = initWorkingCopy(ref, this, flags.base);
        // stdout has only the path, so `$(diff-digest init)` is the path. JSON keeps the warnings.
        if (!flags.json) for (const w of result.warnings) this.out.printError(`warning: ${w}`);
        return result;
    });
}
