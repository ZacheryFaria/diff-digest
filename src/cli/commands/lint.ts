// `lint` and `check`: the format rules and the anchor coverage of a digest.
import { checkDigest } from "../../lib/check";
import { openDigest } from "../../lib/payload";
import { CheckResultSchema } from "../../lib/schemas-api";
import type { CliContext } from "../context";
import { emit } from "../output";
import { checkExitCode, checkText, issueLines, lintExitCode } from "../lint-text";
import { LintOutputSchema } from "../outputs";
import { resolveDigest } from "../ref";
import type { RefFlags } from "./shared";

export async function lint(this: CliContext, flags: RefFlags, ref?: string): Promise<void> {
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
}

export async function check(this: CliContext, flags: RefFlags, ref?: string): Promise<void> {
    let mdPath = "";
    await emit(
        this.out,
        { json: flags.json, schema: CheckResultSchema, text: r => checkText(mdPath, r), exitCode: checkExitCode },
        () => {
            const entry = resolveDigest({ ref, id: flags.id }, this);
            mdPath = entry.mdPath;
            return checkDigest(openDigest(entry, this.home));
        },
    );
}
