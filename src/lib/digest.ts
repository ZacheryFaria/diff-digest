// Pure helpers. The UI imports this file, so it must not import Node or Bun APIs.
import type { ChangedFile } from "./schemas";

export interface Anchor {
    readonly path: string;
    readonly start: number;
    readonly end: number;
}

/** Changes CRLF and CR line ends to LF. marked does the same, so line numbers use LF text. */
export function toLf(text: string): string {
    return text.replaceAll(/\r\n?/gu, "\n");
}

/** An anchor is a code span `path:line` or `path:start-end`. */
export const ANCHOR = /`([\w@#./-]+\.\w+):(\d+)(?:-(\d+))?`/gu;

export function anchors(md: string): Anchor[] {
    const out: Anchor[] = [];
    for (const match of md.matchAll(ANCHOR)) {
        const [, path, start, end] = match;
        if (path === undefined || start === undefined) continue;
        out.push({ path, start: Number(start), end: Number(end ?? start) });
    }
    return out;
}

/** True when `suffix` is the full path or a path suffix that starts at a folder edge. */
export function matchesPath(file: string, suffix: string): boolean {
    return file === suffix || file.endsWith(`/${suffix}`);
}

export function findFile(files: readonly ChangedFile[], suffix: string): ChangedFile | undefined {
    if (suffix === "") return undefined;
    return files.find(f => matchesPath(f.path, suffix) || matchesPath(f.oldPath, suffix));
}

/** A stable id for a digest block (djb2 hash, base 36). The UI, the linter, and comments use it. */
export function blockId(section: string, text: string): string {
    const input = `${section}|${text}`;
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) + hash + (input.codePointAt(i) ?? 0)) >>> 0;
    }
    return (hash >>> 0).toString(36);
}
