// `comments --publish`: post the open user comments as one review comment, and mark them shared.
import type { BackendDeps } from "../backends/types";
import type { OpenDigest } from "../payload";
import { reviewMarkdown } from "../review";
import { readComments, updateComments } from "../store";
import { DigestError } from "../errors";
import { linkContext, linkHead, placeFor } from "./context";
import { checkNotAllFailed, settleEach } from "./failures";
import type { PublishReport } from "./schemas";

export async function publishReview(
    open: OpenDigest,
    to: readonly string[],
    home: string | undefined,
    deps: BackendDeps,
): Promise<PublishReport> {
    const comments = readComments(open.entry.mdPath);
    const ids = new Set(comments.filter(c => c.status === "open" && c.author === "user").map(c => c.id));
    if (ids.size === 0) throw new DigestError("BAD_INPUT", "No open comments to post.");
    const { placed, skipped, failed } = await placeFor(open, to, home, deps);
    const head = linkHead(open);
    const { results, errors: failures } = await settleEach(placed, p => {
        const review = reviewMarkdown(comments, (path, start, end, side) =>
            p.backend.anchorLink(
                { path, start, end },
                linkContext(open, p.location, side === "base" ? open.frontmatter.base : head),
            ),
        );
        return p.backend.publishReview(p.location, review, head);
    });
    const errors = [...failed, ...failures];
    checkNotAllFailed(errors, results.length);
    const ref = results[0]?.ref;
    if (ref !== undefined) {
        updateComments(open.entry.mdPath, list =>
            list.map(c => (ids.has(c.id) ? { ...c, status: "shared" as const, ref } : c)),
        );
    }
    return { results, previews: [], skipped, errors };
}
