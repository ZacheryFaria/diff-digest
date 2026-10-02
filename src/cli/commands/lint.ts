// `lint` and `check`: the format rules and the anchor coverage of a digest.
import { buildCommand } from "@stricli/core";
import { checkDigest } from "../../lib/check";
import { openDigest } from "../../lib/payload";
import { CheckResultSchema } from "../../lib/schemas-api";
import type { CliContext } from "../context";
import { emit, jsonFlag } from "../output";
import { checkExitCode, checkText, issueLines, lintExitCode } from "../lint-text";
import { LintOutputSchema } from "../outputs";
import { resolveDigest } from "../ref";
import { idFlag, refPositional, type RefFlags } from "./shared";

export const lintCommand = buildCommand({
    docs: { brief: "Check the digest against the format rules (exit 5 on an error)" },
    parameters: { flags: { json: jsonFlag, id: idFlag }, positional: refPositional },
    async func(this: CliContext, flags: RefFlags, ref?: string) {
        let mdPath = "";
        await emit(
            this.out,
            {
                json: flags.json,
                schema: LintOutputSchema,
                text: issues => (issues.length === 0 ? "No lint issues." : issueLines(mdPath, issues).join("\n")),
                exitCode: lintExitCode,
            },
            () => {
                const entry = resolveDigest({ ref, id: flags.id }, this);
                mdPath = entry.mdPath;
                return checkDigest(openDigest(entry, this.home)).issues;
            },
        );
    },
});

export const checkCommand = buildCommand({
    docs: { brief: "lint + anchor coverage (exit 5 on a lint error, 6 on a coverage gap)" },
    parameters: { flags: { json: jsonFlag, id: idFlag }, positional: refPositional },
    async func(this: CliContext, flags: RefFlags, ref?: string) {
        let mdPath = "";
        await emit(
            this.out,
            {
                json: flags.json,
                schema: CheckResultSchema,
                text: r => checkText(mdPath, r),
                exitCode: checkExitCode,
            },
            () => {
                const entry = resolveDigest({ ref, id: flags.id }, this);
                mdPath = entry.mdPath;
                return checkDigest(openDigest(entry, this.home));
            },
        );
    },
});
