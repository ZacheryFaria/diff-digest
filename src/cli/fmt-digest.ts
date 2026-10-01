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

export async function fmtDigest(
    entry: RegistryEntry,
    home: string,
    options: { readonly check: boolean; readonly questionsToNotes: boolean },
): Promise<FmtResult> {
    const md = readFileSync(entry.mdPath, "utf8");
    const { frontmatter, body } = parseDigest(md);
    const result = formatDigest(body, { questionsToNotes: options.questionsToNotes && !options.check });
    const next = serializeDigest(frontmatter, result.body);
    if (options.check || next === md) return { path: entry.mdPath, changed: next !== md, questions: [] };
    writeAtomic(entry.mdPath, next);
    const title = buildModel(result.body).title?.text;
    if (title !== undefined) {
        const api = localApi(home);
        // One note at a time, in order: each one is a locked write of the comments file.
        await result.questions.reduce<Promise<unknown>>(
            (previous, question) =>
                previous.then(() => api.comments.note({ id: entry.id, text: title, body: question })),
            Promise.resolve(),
        );
    }
    return { path: entry.mdPath, changed: true, questions: result.questions };
}
