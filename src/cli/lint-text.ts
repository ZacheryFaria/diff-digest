// The text form and the exit codes of `lint` and `check`.
import { EXIT_CODES } from "../lib/errors";
import { hasErrors } from "../lib/lint";
import type { CheckResult } from "../lib/schemas-api";
import type { LintOutput } from "./outputs";

export function issueLines(path: string, issues: LintOutput): string[] {
    return issues.map(
        i => `${path}:${i.line}: ${i.severity} ${i.rule}: ${i.message}${i.hint === undefined ? "" : ` (${i.hint})`}`,
    );
}

export function checkText(path: string, result: CheckResult): string {
    const lines = issueLines(path, result.issues);
    if (result.gaps.length > 0)
        lines.push(`${result.gaps.length} hunk(s) have no anchor:`, ...result.gaps.map(g => `  ${g}`));
    return lines.length === 0 ? "OK: no lint errors, and every reviewable hunk has an anchor." : lines.join("\n");
}

export function lintExitCode(issues: LintOutput): number {
    return hasErrors(issues) ? EXIT_CODES.LINT_FAILED : 0;
}

export function checkExitCode(result: CheckResult): number {
    if (hasErrors(result.issues)) return EXIT_CODES.LINT_FAILED;
    return result.gaps.length > 0 ? EXIT_CODES.COVERAGE_GAP : 0;
}
