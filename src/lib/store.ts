import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { DigestError } from "./errors";
import { storeDir } from "./paths";
import { CommentsFileSchema, type Comment } from "./schemas";

/** Writes a temp file in the same folder, then renames it, so a reader never sees half a file. */
export function writeAtomic(path: string, data: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, data);
    renameSync(temp, path);
}

export function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        throw new DigestError("BAD_INPUT", `${path} is not valid JSON.`, { cause: error });
    }
}

/** The working copy of a digest: `store/<repo>/<name>.md`. */
export function workingCopyPath(repo: string, name: string, home?: string): string {
    return join(storeDir(home), repo, `${name}.md`);
}

export function commentsPath(mdPath: string): string {
    return `${mdPath.replace(/\.md$/u, "")}.comments.json`;
}

export function readComments(mdPath: string): readonly Comment[] {
    const path = commentsPath(mdPath);
    if (!existsSync(path)) return [];
    const result = CommentsFileSchema.safeParse(readJson(path));
    if (!result.success) {
        throw new DigestError(
            "BAD_INPUT",
            `${path} does not match the comments schema:\n${z.prettifyError(result.error)}`,
        );
    }
    return result.data;
}

export function writeComments(mdPath: string, comments: readonly Comment[]): void {
    writeAtomic(commentsPath(mdPath), `${JSON.stringify(CommentsFileSchema.parse(comments), null, 2)}\n`);
}
