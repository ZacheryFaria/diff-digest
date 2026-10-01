// `check`: lint with real anchor checks, plus anchor coverage of the diff.
import { coverageGaps } from "./coverage";
import { findFile, type Anchor } from "./digest";
import { newExists, newText } from "./diff";
import { resolveTracked } from "./files";
import { lintDigest } from "./lint";
import type { OpenDigest } from "./payload";
import type { CheckResult } from "./schemas-api";

/** The lint anchor check: the path must match a file, and the range must be inside it. */
export function anchorChecker(open: OpenDigest): (anchor: Anchor) => string | null {
    return anchor => {
        const label = `\`${anchor.path}:${anchor.start}${anchor.end === anchor.start ? "" : `-${anchor.end}`}\``;
        const path = findFile(open.files, anchor.path)?.path ?? resolveTracked(open.ctx, anchor.path);
        if (path === undefined) return `${label}: no single file matches this path.`;
        if (!newExists(open.ctx, path)) return `${label}: ${path} is deleted in this change.`;
        const lines = newText(open.ctx, path).replace(/\n$/u, "").split("\n").length;
        return anchor.end > lines ? `${label}: ${path} has only ${lines} lines.` : null;
    };
}

/** `check` = lint + anchor coverage. */
export function checkDigest(open: OpenDigest): CheckResult {
    return {
        issues: lintDigest(open.md, { checkAnchor: anchorChecker(open) }),
        gaps: coverageGaps(open.ctx, open.body, open.files),
    };
}
