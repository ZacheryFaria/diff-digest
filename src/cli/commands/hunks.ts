// `hunks`: the changed files with their classes and the reviewable hunks.
import { buildCommand } from "@stricli/core";
import { generatedMatcher, readConfigFile, resolveConfig } from "../../lib/config";
import { changedFiles, diffLineCount, isReviewable, reviewableHunks } from "../../lib/diff";
import { configPath } from "../../lib/paths";
import { repoKeys, type RepoContext } from "../../lib/repo";
import type { CliContext } from "../context";
import { emit, jsonFlag } from "../output";
import { HunksOutputSchema, type HunksOutput } from "../outputs";
import { workingCopyFor } from "../ref";
import { refPositional, type JsonFlags } from "./shared";

export const hunksCommand = buildCommand({
    docs: { brief: "Sort the changed files into classes and list the reviewable hunks" },
    parameters: { flags: { json: jsonFlag }, positional: refPositional },
    async func(this: CliContext, flags: JsonFlags, ref?: string) {
        await emit(this.out, { json: flags.json, schema: HunksOutputSchema, text: hunksText }, () => {
            const { root, target } = workingCopyFor(ref, this);
            const ctx: RepoContext = {
                root,
                base: target.base,
                head: target.checkedOut || target.head === null ? "worktree" : target.head,
            };
            const files = changedFiles(
                ctx,
                generatedMatcher(resolveConfig(readConfigFile(configPath(this.home)), repoKeys(root))),
            );
            return {
                base: target.base,
                head: ctx.head,
                files: files.map(f => ({
                    ...f,
                    hunks: isReviewable(f)
                        ? reviewableHunks(ctx, f).map(h => ({ start: h.start, end: h.end, size: h.size }))
                        : [],
                })),
                reviewableLines: diffLineCount(ctx, files),
            };
        });
    },
});

function hunksText(r: HunksOutput): string {
    const lines = [
        `base ${r.base.slice(0, 11)}  head ${r.head === "worktree" ? "working tree" : r.head.slice(0, 11)}`,
        "",
    ];
    for (const f of r.files) {
        lines.push(`${f.cls.padEnd(9)} ${f.status} ${f.oldPath === f.path ? "" : `${f.oldPath} -> `}${f.path}`);
        for (const h of f.hunks) lines.push(`          @@ ${h.start}-${h.end} (${h.size} lines)`);
    }
    lines.push("", `reviewable diff lines: ${r.reviewableLines}`);
    return lines.join("\n");
}
