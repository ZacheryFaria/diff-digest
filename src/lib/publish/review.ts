// `comments --publish`: post the open user comments as one review comment, and mark them shared.
import type { BackendDeps } from "../backends/types";
import type { OpenDigest } from "../payload";
import { reviewMarkdown } from "../review";
import { readComments, updateComments } from "../store";
import { backendsFor, linkContext, linkHead, locateInput, place } from "./context";
import type { PublishReport } from "./schemas";

export async function publishReview(
    open: OpenDigest,
    to: readonly string[],
    home: string | undefined,
    deps: BackendDeps,
): Promise<PublishReport> {
    const comments = readComments(open.entry.mdPath);
    const ids = new Set(comments.filter(c => c.status === "open" && c.author === "user").map(c => c.id));
    const { placed, skipped } = await place(backendsFor(open.entry.root, to, home, deps), locateInput(open, null));
    const head = linkHead(open);
    const results = await Promise.all(
        placed.map(p => {
            const review = reviewMarkdown(comments, (path, start, end, side) =>
                p.backend.anchorLink(
                    { path, start, end },
                    linkContext(open, p.location, side === "base" ? open.frontmatter.base : head),
                ),
            );
            return p.backend.publishReview(p.location, review, head);
        }),
    );
    const ref = results[0]?.ref;
    if (ref !== undefined && ids.size > 0) {
        updateComments(open.entry.mdPath, list =>
            list.map(c => (ids.has(c.id) ? { ...c, status: "shared" as const, ref } : c)),
        );
    }
    return { results, previews: [], skipped };
}
