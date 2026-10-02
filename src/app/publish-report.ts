// The text for a publish report. Pure: the dialogs and the tests use it.
import type { PublishReport } from "../lib/publish/schemas";

/** No backend was used: none was chosen and the config has no `publishTo`. */
export function isEmptyReport(report: PublishReport): boolean {
    return report.results.length + report.skipped.length + report.errors.length === 0;
}

export function reportSummary(report: PublishReport): string {
    if (isEmptyReport(report)) return "No backend. Choose one, or set publishTo in the config.";
    const done = report.results.map(r => `${r.updated ? "updated" : "posted"} ${r.backend}`);
    const skipped = report.skipped.map(s => `skipped ${s}`);
    const failed = report.errors.map(e => `${e.backend} failed: ${e.message}`);
    return [...done, ...skipped, ...failed].join("; ");
}
