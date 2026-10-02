// `publish`: render the digest's anchors for each backend and post it there.
import type { BackendDeps, DigestMeta } from "../backends/types";
import { checkDigest } from "../check";
import { DigestError } from "../errors";
import { hasErrors } from "../lint";
import type { OpenDigest } from "../payload";
import { renderLinks } from "../render";
import { isSha } from "../schemas";
import { linkContext, linkHead, placeFor } from "./context";
import { checkNotAllFailed, failureOf, settleEach } from "./failures";
import type { PublishReport } from "./schemas";

export interface PublishOptions {
    readonly to: readonly string[];
    readonly force: boolean;
    readonly dryRun: boolean;
    readonly home?: string;
}

function metaOf(open: OpenDigest): DigestMeta {
    const head = linkHead(open);
    return {
        v: 1,
        id: open.frontmatter.id,
        branch: open.frontmatter.branch,
        base: open.frontmatter.base,
        head: isSha(head) ? head : null,
    };
}

export async function publishDigest(
    open: OpenDigest,
    options: PublishOptions,
    deps: BackendDeps,
): Promise<PublishReport> {
    const issues = checkDigest(open).issues;
    if (hasErrors(issues) && !options.force) {
        throw new DigestError("LINT_FAILED", "The digest has lint errors, so it is not published.", {
            hint: "Run `diff-digest check`, or publish with --force.",
            data: issues,
        });
    }
    const { placed, skipped, failed } = await placeFor(open, options.to, options.home, deps);
    const meta = metaOf(open);
    const rendered = placed.map(p => ({
        ...p,
        text: renderLinks(open.body, a => p.backend.anchorLink(a, linkContext(open, p.location))),
    }));
    if (options.dryRun) {
        const settled = await Promise.allSettled(rendered.map(r => r.backend.envelope(r.location, r.text, meta)));
        const previews = rendered.flatMap((r, i) => {
            const s = settled[i];
            return s?.status === "fulfilled" ? [{ backend: r.backend.name, text: s.value }] : [];
        });
        const errors = [
            ...failed,
            ...rendered.flatMap((r, i) => {
                const s = settled[i];
                return s?.status === "rejected" ? [failureOf(r.backend.name, s.reason)] : [];
            }),
        ];
        checkNotAllFailed(errors, previews.length);
        return { results: [], previews, skipped, errors };
    }
    const { results, errors: failures } = await settleEach(rendered, r => r.backend.publish(r.location, r.text, meta));
    const errors = [...failed, ...failures];
    checkNotAllFailed(errors, results.length);
    return { results, previews: [], skipped, errors };
}
