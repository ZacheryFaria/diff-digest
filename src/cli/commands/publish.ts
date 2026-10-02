// `publish` and `pull`: send the digest to its backends, or get it back from one.
import { realDeps } from "../../lib/backends/deps";
import { pullDigest } from "../../lib/publish/pull";
import { PublishReportSchema, PullReportSchema, type PublishReport } from "../../lib/publish/schemas";
import { localApi } from "../api";
import type { CliContext } from "../context";
import { emit } from "../output";
import { resolveDigest, workingCopyFor } from "../ref";
import { splitList, type RefFlags } from "./shared";

export function reportText(report: PublishReport): string {
    const lines = [
        ...report.results.map(r => `${r.updated ? "updated" : "posted"} ${r.backend}: ${r.ref}`),
        ...report.results.flatMap(r => r.warnings.map(w => `warning (${r.backend}): ${w}`)),
        ...report.previews.map(p => `--- ${p.backend} ---\n${p.text}`),
        ...report.skipped.map(s => `skipped ${s}`),
    ];
    return lines.length === 0 ? "Nothing was published." : lines.join("\n");
}

export interface PublishFlags extends RefFlags {
    readonly to?: string;
    readonly dryRun: boolean;
    readonly force: boolean;
}

export async function publish(this: CliContext, flags: PublishFlags, ref?: string): Promise<void> {
    await emit(this.out, { json: flags.json, schema: PublishReportSchema, text: reportText }, () => {
        const entry = resolveDigest({ ref, id: flags.id }, this);
        return localApi(this.home).publish.digest({
            id: entry.id,
            to: splitList(flags.to),
            force: flags.force,
            dryRun: flags.dryRun,
        });
    });
}

export interface PullFlags {
    readonly json: boolean;
    readonly from?: string;
    readonly force: boolean;
}

export async function pull(this: CliContext, flags: PullFlags, ref?: string): Promise<void> {
    await emit(
        this.out,
        {
            json: flags.json,
            schema: PullReportSchema,
            text: r =>
                `${r.path}\nfrom ${r.backend}: ${r.ref}${r.stale ? "\nwarning: the digest is for another head than the target" : ""}`,
        },
        () => {
            const { root, target } = workingCopyFor(ref, this);
            return pullDigest(
                root,
                target,
                { from: splitList(flags.from), force: flags.force, home: this.home },
                realDeps,
            );
        },
    );
}

export interface PublishCommentsFlags extends RefFlags {
    readonly to?: string;
}

/** `comments --publish`: post the open user comments as one review on the backends. */
export async function publishComments(this: CliContext, flags: PublishCommentsFlags, ref?: string): Promise<void> {
    await emit(this.out, { json: flags.json, schema: PublishReportSchema, text: reportText }, () => {
        const entry = resolveDigest({ ref, id: flags.id }, this);
        return localApi(this.home).publish.review({ id: entry.id, to: splitList(flags.to) });
    });
}
