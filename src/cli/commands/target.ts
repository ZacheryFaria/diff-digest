// `target`, `path`, `init`: what a digest describes and where its working copy is.
import { existsSync } from "node:fs";
import { buildCommand } from "@stricli/core";
import type { CliContext } from "../context";
import { initWorkingCopy } from "../init";
import { emit, jsonFlag } from "../output";
import { InitOutputSchema, PathOutputSchema } from "../outputs";
import { workingCopyFor } from "../ref";
import { TargetSchema } from "../target";
import { refPositional, type JsonFlags } from "./shared";

export const targetCommand = buildCommand({
    docs: { brief: "Show the base, head, and working copy name for a target" },
    parameters: { flags: { json: jsonFlag }, positional: refPositional },
    async func(this: CliContext, flags: JsonFlags, ref?: string) {
        await emit(
            this.out,
            { json: flags.json, schema: TargetSchema, text: t => JSON.stringify(t, null, 2) },
            () => workingCopyFor(ref, this).target,
        );
    },
});

export const pathCommand = buildCommand({
    docs: { brief: "Print the working copy path for a target" },
    parameters: { flags: { json: jsonFlag }, positional: refPositional },
    async func(this: CliContext, flags: JsonFlags, ref?: string) {
        await emit(this.out, { json: flags.json, schema: PathOutputSchema, text: p => p.path }, () => {
            const { mdPath } = workingCopyFor(ref, this);
            return { path: mdPath, exists: existsSync(mdPath) };
        });
    },
});

export const initCommand = buildCommand({
    docs: { brief: "Create the working copy with its frontmatter, and print its id and path" },
    parameters: { flags: { json: jsonFlag }, positional: refPositional },
    async func(this: CliContext, flags: JsonFlags, ref?: string) {
        await emit(this.out, { json: flags.json, schema: InitOutputSchema, text: r => r.path }, () =>
            initWorkingCopy(ref, this),
        );
    },
});
