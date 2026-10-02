// Links in a static export: anchors and files open the repo web page at the head commit.
import type { StaticPayload } from "../lib/schemas-api";

export interface ExportLinks {
    /** The web URL for a path (a unique suffix is enough) and lines, or null when there is none. */
    readonly linkFor: (path: string, start?: number, end?: number) => string | null;
}

export function exportLinks(payload: StaticPayload): ExportLinks {
    const { repoUrl } = payload;
    const { head, files } = payload.digest;
    return {
        linkFor: (path, start, end) => {
            const file = files.find(f => f.path === path || f.path.endsWith(`/${path}`));
            // A deleted or an untracked file is not in the head commit.
            if (repoUrl === null || head === null || file === undefined || file.status === "D" || file.untracked)
                return null;
            const lines = start === undefined ? "" : `#L${start}-L${end ?? start}`;
            return `${repoUrl}/blob/${head}/${file.path}${lines}`;
        },
    };
}
