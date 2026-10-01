// `fmt`: apply the safe fixes to a digest.
import { buildCommand } from "@stricli/core";
import { EXIT_CODES } from "../../lib/errors";
import type { CliContext } from "../context";
import { fmtDigest } from "../fmt-digest";
import { emit, jsonFlag } from "../output";
import { FmtOutputSchema } from "../outputs";
import { resolveDigest } from "../ref";
import { idFlag, refPositional, type RefFlags } from "./shared";

interface FmtFlags extends RefFlags {
    readonly check: boolean;
    readonly questionsToNotes: boolean;
}

export const fmtCommand = buildCommand({
    docs: { brief: "Apply the safe fixes to the digest (--check: exit 5 if a fix is needed)" },
    parameters: {
        flags: {
            json: jsonFlag,
            id: idFlag,
            check: { kind: "boolean", brief: "Change nothing; exit 5 if the file would change", default: false },
            questionsToNotes: { kind: "boolean", brief: "Move a Questions section into agent notes", default: false },
        },
        positional: refPositional,
    },
    async func(this: CliContext, flags: FmtFlags, ref?: string) {
        await emit(
            this.out,
            {
                json: flags.json,
                schema: FmtOutputSchema,
                text: r =>
                    `${r.changed ? (flags.check ? "Would change" : "Changed") : "No change"}: ${r.path}${r.questions.length > 0 ? ` (${r.questions.length} question(s) moved to notes)` : ""}`,
                exitCode: r => (flags.check && r.changed ? EXIT_CODES.LINT_FAILED : 0),
            },
            () => fmtDigest(resolveDigest({ ref, id: flags.id }, this), this.home, flags),
        );
    },
});
