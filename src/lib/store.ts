import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { DigestError } from "./errors";
import { withLock } from "./lock";
import { storeDir } from "./paths";
import { CommentsFileSchema, type Comment } from "./schemas";

/** Writes a temp file in the same folder, then renames it, so a reader never sees half a file. */
export function writeAtomic(path: string, data: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, data);
    try {
        renameSync(temp, path);
    } catch (error) {
        rmSync(temp, { force: true });
        throw error;
    }
}

export function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        throw new DigestError("BAD_INPUT", `${path} is not valid JSON.`, { cause: error });
    }
}

function pathSegment(value: string, what: string): string {
    if (value === "" || value === "." || value === ".." || /[/\\]/u.test(value)) {
        throw new DigestError("BAD_INPUT", `The ${what} "${value}" is not a safe file name.`);
    }
    return value;
}

/** The working copy of a digest: `store/<repo>/<name>.md`. `repo` and `name` must be single file names. */
export function workingCopyPath(repo: string, name: string, home?: string): string {
    return join(storeDir(home), pathSegment(repo, "repo"), `${pathSegment(name, "digest name")}.md`);
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

/** Reads, changes, and writes the comments under the lock, so concurrent writers do not lose changes. */
export function updateComments(
    mdPath: string,
    change: (comments: readonly Comment[]) => readonly Comment[],
): readonly Comment[] {
    return withLock(commentsPath(mdPath), () => {
        const next = change(readComments(mdPath));
        writeComments(mdPath, next);
        return next;
    });
}
