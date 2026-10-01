import { anchors, matchesPath } from "./digest";
import { isReviewable, reviewableHunks } from "./diff";
import type { RepoContext } from "./repo";
import type { ChangedFile } from "./schemas";

/** The reviewable hunks that no anchor in the digest touches, as `path:start-end` or `path (deleted)`. */
export function coverageGaps(ctx: RepoContext, md: string, files: readonly ChangedFile[]): string[] {
    const all = anchors(md);
    const gaps: string[] = [];
    for (const file of files) {
        if (!isReviewable(file)) continue;
        const own = all.filter(a => matchesPath(file.path, a.path) || matchesPath(file.oldPath, a.path));
        if (file.status === "D") {
            const name = file.oldPath.split("/").at(-1) ?? file.oldPath;
            if (!md.includes(name)) gaps.push(`${file.oldPath} (deleted)`);
            continue;
        }
        for (const h of reviewableHunks(ctx, file)) {
            const covered = own.some(a => a.start <= h.end + 1 && a.end >= h.start - 1);
            if (!covered) gaps.push(`${file.path}:${h.start}-${h.end}`);
        }
    }
    return gaps;
}
