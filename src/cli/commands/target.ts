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
    await emit(
        this.out,
        {
            json: flags.json,
            schema: InitOutputSchema,
            text: r => [r.path, ...r.warnings.map(w => `warning: ${w}`)].join("\n"),
        },
        () => initWorkingCopy(ref, this, flags.base),
    );
}
