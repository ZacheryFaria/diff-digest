import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    ChangedFileSchema,
    FileStatusSchema,
    type ChangedFile,
    type DiffLine,
    type FileClass,
    type Hunk,
} from "./schemas";
import { git, runGit, type RepoContext } from "./repo";

export const BUILTIN_GENERATED: readonly RegExp[] = [
    /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|go\.sum|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|flake\.lock)$/u,
    /\.snap$/u,
    /(^|\/)__generated__\//u,
    /\.pb\.(ts|go)$|_pb2\.py$/u,
    /\.min\.(js|css)$|\.map$/u,
];

/** True when a built-in pattern marks the path as generated. */
export function isBuiltinGenerated(path: string): boolean {
    for (const pattern of BUILTIN_GENERATED) if (pattern.test(path)) return true;
    return false;
}

const TEST = /(\.(test|spec)\.[cm]?[jt]sx?$)|(\/__tests__\/)|(_test\.(go|py)$)|((^|\/)test_[^/]+\.py$)/u;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

function rangeArgs(ctx: RepoContext): string[] {
    return ctx.head === "worktree" ? [ctx.base] : [ctx.base, ctx.head];
}

/** The file text after the change. */
export function newText(ctx: RepoContext, path: string): string {
    return ctx.head === "worktree"
        ? readFileSync(join(ctx.root, path), "utf8")
        : git(ctx.root, ["show", `${ctx.head}:${path}`]);
}

export function newExists(ctx: RepoContext, path: string): boolean {
    if (ctx.head === "worktree") return existsSync(join(ctx.root, path));
    return runGit(ctx.root, ["cat-file", "-e", `${ctx.head}:${path}`]).ok;
}

/** git's test for a binary file: a NUL byte in the first 8000 bytes. */
export function isBinaryFile(fullPath: string): boolean {
    return readFileSync(fullPath).subarray(0, 8000).includes(0);
}

/**
 * The files that changed between the base and the head, with a class for each file.
 * For the working tree, untracked files that .gitignore does not exclude count as added.
 */
export function changedFiles(ctx: RepoContext, isGenerated: (path: string) => boolean): ChangedFile[] {
    const range = rangeArgs(ctx);
    const entries: Omit<ChangedFile, "cls">[] = [];
    const tokens = git(ctx.root, ["diff", "--no-ext-diff", "--name-status", "-z", "-M", ...range]).split("\0");
    for (let i = 0; i < tokens.length;) {
        const status = tokens[i];
        if (status === undefined || status === "") {
            i += 1;
            continue;
        }
        const letter = FileStatusSchema.parse(status.charAt(0));
        if (letter === "R" || letter === "C") {
            const oldPath = tokens[i + 1];
            const path = tokens[i + 2];
            if (oldPath === undefined || path === undefined) break;
            entries.push({ status: letter, oldPath, path, untracked: false });
            i += 3;
        } else {
            const path = tokens[i + 1];
            if (path === undefined) break;
            entries.push({ status: letter, oldPath: path, path, untracked: false });
            i += 2;
        }
    }
    if (ctx.head === "worktree") {
        for (const path of git(ctx.root, ["ls-files", "-z", "--others", "--exclude-standard"]).split("\0")) {
            if (path !== "" && !path.endsWith("/")) entries.push({ status: "A", oldPath: path, path, untracked: true });
        }
    }
    const binary = binaryPaths(ctx, range);
    for (const e of entries) if (e.untracked && isBinaryFile(join(ctx.root, e.path))) binary.add(e.path);
    const attrs = checkAttrs(
        ctx,
        entries.map(e => e.path),
    );
    return entries.map(e =>
        ChangedFileSchema.parse({
            ...e,
            cls: classify(e.path, attrs.get(e.path) ?? {}, binary.has(e.path), isGenerated),
        }),
    );
}

function isAttrSet(value: string | undefined): boolean {
    return value === "set" || value === "true";
}

function classify(
    path: string,
    attrs: Readonly<Record<string, string>>,
    binary: boolean,
    isGenerated: (path: string) => boolean,
): FileClass {
    // linguist-generated=false only changes GitHub's diff view, so it does not make a file reviewable.
    if (isAttrSet(attrs["linguist-generated"]) || isAttrSet(attrs["linguist-vendored"])) return "generated";
    if (attrs["filter"] === "lfs" || binary) return "binary";
    if (isBuiltinGenerated(path) || isGenerated(path)) return "generated";
    return TEST.test(path) ? "test" : "source";
}

function binaryPaths(ctx: RepoContext, range: readonly string[]): Set<string> {
    const tokens = git(ctx.root, ["diff", "--no-ext-diff", "--numstat", "-z", "-M", ...range]).split("\0");
    const out = new Set<string>();
    for (let i = 0; i < tokens.length; i += 1) {
        const match = /^(\S+)\t(\S+)\t(.*)$/u.exec(tokens[i] ?? "");
        if (match === null) continue;
        const [, added, , inline] = match;
        // A rename has an empty path field, then the old path and the new path as two more tokens.
        const path = inline === undefined || inline === "" ? tokens[i + 2] : inline;
        if (inline === undefined || inline === "") i += 2;
        if (added === "-" && path !== undefined) out.add(path);
    }
    return out;
}

function checkAttrs(ctx: RepoContext, paths: readonly string[]): Map<string, Record<string, string>> {
    const attrs = new Map<string, Record<string, string>>();
    if (paths.length === 0) return attrs;
    const source = ctx.head === "worktree" ? [] : [`--source=${ctx.head}`];
    const out = git(
        ctx.root,
        ["check-attr", "-z", "--stdin", ...source, "linguist-generated", "linguist-vendored", "filter"],
        `${paths.join("\0")}\0`,
    ).split("\0");
    for (let i = 0; i + 2 < out.length; i += 3) {
        const [path, name, value] = [out[i], out[i + 1], out[i + 2]];
        if (path === undefined || name === undefined || value === undefined) continue;
        attrs.set(path, { ...attrs.get(path), [name]: value });
    }
    return attrs;
}

interface HunkBuilder {
    readonly header: Omit<Hunk, "removed" | "added" | "size">;
    readonly removed: DiffLine[];
    readonly added: DiffLine[];
}

interface HunkStart {
    readonly builder: HunkBuilder;
    readonly oldN: number;
    readonly newN: number;
    readonly oldLeft: number;
    readonly newLeft: number;
}

/** A new hunk builder from a `@@ ... @@` header's captures, with its line counters. */
function startHunk(
    oldStart: string,
    oldCount: string | undefined,
    newStart: string,
    newCount: string | undefined,
): HunkStart {
    const oldN = Number(oldStart);
    const newN = Number(newStart);
    const newLeft = newCount === undefined ? 1 : Number(newCount);
    const oldLeft = oldCount === undefined ? 1 : Number(oldCount);
    return {
        builder: {
            header: {
                start: Math.max(newN, 1),
                end: Math.max(newN + newLeft - 1, newN, 1),
                oldStart: oldN,
                oldCount: oldLeft,
                newStart: newN,
                newCount: newLeft,
            },
            removed: [],
            added: [],
        },
        oldN,
        newN,
        oldLeft,
        newLeft,
    };
}

export function parseDiff(text: string): Hunk[] {
    const builders: HunkBuilder[] = [];
    let current: HunkBuilder | null = null;
    let oldN = 0;
    let newN = 0;
    // Lines still expected on each side of the open hunk, from its header's oldCount/newCount.
    // A "---"/"+++ " line is a real file header only outside any hunk, or once both reach zero;
    // otherwise it is hunk content (for example a removed "-- note" or added "++ x" line).
    let oldLeft = 0;
    let newLeft = 0;
    for (const line of text.split("\n")) {
        const match = HUNK_HEADER.exec(line);
        if (match !== null) {
            const [, oldStart = "0", oldCount, newStart = "0", newCount] = match;
            const started = startHunk(oldStart, oldCount, newStart, newCount);
            current = started.builder;
            oldN = started.oldN;
            newN = started.newN;
            oldLeft = started.oldLeft;
            newLeft = started.newLeft;
            builders.push(current);
        } else if (current === null || (oldLeft <= 0 && newLeft <= 0 && /^(\+\+\+|---) /u.test(line))) {
            continue;
        } else if (line.startsWith("-")) {
            current.removed.push({ n: oldN, text: line.slice(1) });
            oldN += 1;
            oldLeft -= 1;
        } else if (line.startsWith("+")) {
            current.added.push({ n: newN, text: line.slice(1) });
            newN += 1;
            newLeft -= 1;
        } else if (line.startsWith(" ")) {
            oldN += 1;
            newN += 1;
            oldLeft -= 1;
            newLeft -= 1;
        }
    }
    const hunks: Hunk[] = [];
    for (const b of builders) {
        hunks.push({ ...b.header, removed: b.removed, added: b.added, size: b.removed.length + b.added.length });
    }
    return hunks;
}

export function rawDiff(ctx: RepoContext, file: Readonly<ChangedFile>, context = 0): string {
    if (file.untracked) {
        // --no-index exits with 1 when the files differ, so a non-zero exit is not an error here.
        return runGit(ctx.root, ["diff", "--no-ext-diff", "--no-index", `-U${context}`, "--", "/dev/null", file.path])
            .stdout;
    }
    const paths = file.oldPath === file.path ? [file.path] : [file.oldPath, file.path];
    return git(ctx.root, ["diff", "--no-ext-diff", `-U${context}`, "-M", ...rangeArgs(ctx), "--", ...paths]);
}

/** The line numbers (1-based) that are part of an import or a re-export statement. */
export function importLines(text: string): Set<number> {
    const lines = new Set<number>();
    let inImport = false;
    for (const [i, line] of text.split("\n").entries()) {
        if (/^\s*import\b/u.test(line) || /^\s*export\s+(\*|\{[^}]*\})\s+from\b/u.test(line)) inImport = true;
        if (inImport) lines.add(i + 1);
        if (inImport && /(from\s+["'][^"']+["']|^\s*import\s+["'][^"']+["'])\s*;?\s*$/u.test(line)) inImport = false;
    }
    return lines;
}

function blank(text: string): boolean {
    return text.trim() === "";
}

/** The hunks to review: drops hunks that only touch imports and hunks whose lines all moved. */
export function reviewableHunks(ctx: RepoContext, file: Readonly<ChangedFile>): Hunk[] {
    const hunks = parseDiff(rawDiff(ctx, file));
    const oldImports =
        file.status === "A" ? new Set<number>() : importLines(git(ctx.root, ["show", `${ctx.base}:${file.oldPath}`]));
    const newImports = file.status === "D" ? new Set<number>() : importLines(newText(ctx, file.path));
    const allRemoved = new Set(hunks.flatMap(h => h.removed.map(l => l.text.trim())));
    const allAdded = new Set(hunks.flatMap(h => h.added.map(l => l.text.trim())));
    return hunks.filter(h => {
        const importOnly =
            h.removed.every(l => oldImports.has(l.n) || blank(l.text)) &&
            h.added.every(l => newImports.has(l.n) || blank(l.text));
        const moved =
            h.added.every(l => blank(l.text) || allRemoved.has(l.text.trim())) &&
            h.removed.every(l => blank(l.text) || allAdded.has(l.text.trim()));
        return !importOnly && !moved;
    });
}

export function isReviewable(file: Readonly<ChangedFile>): boolean {
    return file.cls === "source" || file.cls === "test";
}

export function diffLineCount(ctx: RepoContext, files: readonly ChangedFile[]): number {
    return files
        .filter(f => isReviewable(f))
        .reduce((n, f) => n + parseDiff(rawDiff(ctx, f)).reduce((s, h) => s + h.size, 0), 0);
}
