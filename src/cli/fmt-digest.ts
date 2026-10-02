// `fmt`: the safe fixes, written to the working copy, and Questions moved to agent notes.
import { readFileSync } from "node:fs";
import { formatDigest } from "../lib/fmt";
import { parseDigest, serializeDigest } from "../lib/frontmatter";
import { buildModel } from "../lib/model";
import type { RegistryEntry } from "../lib/schemas-api";
import { writeAtomic } from "../lib/store";
import { localApi } from "./api";

export interface FmtResult {
    readonly path: string;
    readonly changed: boolean;
    readonly questions: readonly string[];
}

/**
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
    const next = serializeDigest(frontmatter, result.body);
    if (options.check || next === md) return { path: entry.mdPath, changed: next !== md, questions: [] };
    if (title !== undefined && result.questions.length > 0) {
        const api = localApi(home);
        // One note at a time, in order: each one is a locked write of the comments file.
        await result.questions.reduce<Promise<unknown>>(
            (previous, question) =>
                previous.then(() => api.comments.note({ id: entry.id, text: title, body: `Q: ${question}` })),
            Promise.resolve(),
        );
    }
    writeAtomic(entry.mdPath, next);
    return { path: entry.mdPath, changed: true, questions: result.questions };
}
