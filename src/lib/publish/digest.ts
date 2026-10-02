// `publish`: render the digest's anchors for each backend and post it there.
import type { BackendDeps, DigestMeta } from "../backends/types";
import { checkDigest } from "../check";
import { DigestError } from "../errors";
import { hasErrors } from "../lint";
import type { OpenDigest } from "../payload";
import { renderLinks } from "../render";
import { isSha } from "../schemas";
import { backendsFor, linkContext, linkHead, locateInput, place } from "./context";
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
    const { placed, skipped } = await place(
        backendsFor(open.entry.root, options.to, options.home, deps),
        locateInput(open, null),
    );
    const meta = metaOf(open);
    const rendered = placed.map(p => ({
        ...p,
        text: renderLinks(open.body, a => p.backend.anchorLink(a, linkContext(open, p.location))),
    }));
    if (options.dryRun)
        return { results: [], previews: rendered.map(r => ({ backend: r.backend.name, text: r.text })), skipped };
    const results = await Promise.all(rendered.map(r => r.backend.publish(r.location, r.text, meta)));
    return { results, previews: [], skipped };
}
