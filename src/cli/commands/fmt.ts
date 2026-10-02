// `fmt`: apply the safe fixes to a digest.
import { EXIT_CODES } from "../../lib/errors";
import type { CliContext } from "../context";
import { fmtDigest } from "../fmt-digest";
import { emit } from "../output";
import { FmtOutputSchema } from "../outputs";
import { resolveDigest } from "../ref";
import type { RefFlags } from "./shared";

export interface FmtFlags extends RefFlags {
    readonly check: boolean;
    readonly questionsToNotes: boolean;
}

export async function fmt(this: CliContext, flags: FmtFlags, ref?: string): Promise<void> {
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
}
