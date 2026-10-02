// `fmt`: the safe fixes, written to the working copy, and Questions moved to agent notes.
import { readFileSync } from "node:fs";
import { diffLineCount } from "../lib/diff";
import { formatDigest, withSizeLine, type SizeCounts } from "../lib/fmt";
import { parseDigest, serializeDigest } from "../lib/frontmatter";
import { buildModel } from "../lib/model";
import { openDigest } from "../lib/payload";
import { runGit } from "../lib/repo";
import type { RegistryEntry } from "../lib/schemas-api";
import { writeAtomic } from "../lib/store";
import { localApi } from "./api";

export interface FmtResult {
    readonly path: string;
    readonly changed: boolean;
    readonly questions: readonly string[];
}

/** The Size line counts: the reviewable diff lines (as `hunks` counts them) and the commits from base to head. */
function sizeCounts(entry: RegistryEntry, home: string): SizeCounts {
    const { ctx, files } = openDigest(entry, home);
    const head = ctx.head === "worktree" ? "HEAD" : ctx.head;
    const count = runGit(ctx.root, ["rev-list", "--count", `${ctx.base}..${head}`]);
    return { reviewableLines: diffLineCount(ctx, files), commits: count.ok ? Number(count.stdout.trim()) : 0 };
}

/**
 * fmt also writes the summary's Size line from the diff.
 * The notes go on the H1 title. With no title there is no block for them, so the Questions stay.
 * The notes are written before the file: if a note fails, the questions are still in the file.
 */
export async function fmtDigest(
    entry: RegistryEntry,
    home: string,
    options: { readonly check: boolean; readonly questionsToNotes: boolean },
): Promise<FmtResult> {
    const md = readFileSync(entry.mdPath, "utf8");
    const { frontmatter, body } = parseDigest(md);
    const title = buildModel(body).title?.text;
    const move = options.questionsToNotes && !options.check && title !== undefined;
    const result = formatDigest(body, { questionsToNotes: move });
    const next = serializeDigest(frontmatter, withSizeLine(result.body, sizeCounts(entry, home)));
    if (options.check || next === md) return { path: entry.mdPath, changed: next !== md, questions: [] };
    if (title !== undefined && result.questions.length > 0) {
        const api = localApi(home);
        // A second run after a failed note must not add the earlier notes again.
        const existing = new Set(
            (await api.comments.list({ id: entry.id })).filter(c => c.author === "agent").map(c => c.body),
        );
        const fresh = result.questions.filter(q => !existing.has(`Q: ${q}`));
        // One note at a time, in order: each one is a locked write of the comments file.
        await fresh.reduce<Promise<unknown>>(
            (previous, question) =>
                previous.then(() => api.comments.note({ id: entry.id, text: title, body: `Q: ${question}` })),
            Promise.resolve(),
        );
    }
    writeAtomic(entry.mdPath, next);
    return { path: entry.mdPath, changed: true, questions: result.questions };
}
