// The open user comments as one portable Markdown comment (ported from bin/diff-digest.mjs). Pure.
// A backend (plan 5) adds its envelope and turns the labels into links.
import type { Comment } from "./schemas";

/** The URL for a code comment's lines, or null for a plain label. */
export type CodeLinker = (path: string, line: number, endLine: number, side: "base" | "head") => string | null;

const QUOTE_MAX = 160;

function quote(text: string): string {
    const short = text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 3)}…` : text;
    return short.replaceAll("|", String.raw`\|`).replaceAll("`", "'");
}

function indent(text: string): string {
    return text
        .split("\n")
        .map(l => `  ${l}`)
        .join("\n");
}

function digestLines(comments: readonly Comment[]): string[] {
    const out: string[] = [];
    for (const c of comments) {
        if (c.target.kind !== "digest") continue;
        const where = c.target.section === "" ? "" : `**${c.target.section}** · `;
        out.push(`- ${where}“${quote(c.target.text)}”`, indent(c.body), "");
    }
    return out;
}

function codeLines(comments: readonly Comment[], link: CodeLinker): string[] {
    const code = comments.flatMap(c => (c.target.kind === "code" ? [{ comment: c, target: c.target }] : []));
    const sorted = code.toSorted((a, b) => a.target.path.localeCompare(b.target.path) || a.target.line - b.target.line);
    const out: string[] = [];
    for (const { comment, target } of sorted) {
        const end = target.endLine ?? target.line;
        const lines = end === target.line ? `${target.line}` : `${target.line}-${end}`;
        const label = `\`${target.path.split("/").slice(-2).join("/")}:${lines}\``;
        const url = link(target.path, target.line, end, target.rev);
        const first = target.text.split("\n").find(l => l.trim() !== "") ?? "";
        const side = target.rev === "base" ? "before" : "after";
        out.push(
            `- ${url === null ? label : `[${label}](${url})`} (${side}) — \`${quote(first.trim())}\``,
            indent(comment.body),
            "",
        );
    }
    return out;
}

export function reviewMarkdown(comments: readonly Comment[], link: CodeLinker = () => null): string {
    const open = comments.filter(c => c.status === "open" && c.author === "user");
    const onDigest = digestLines(open);
    const onCode = codeLines(open, link);
    const out = ["### Comments on the digest and code", ""];
    if (onDigest.length > 0) out.push("**On the digest**", "", ...onDigest);
    if (onCode.length > 0) out.push("**On the code**", "", ...onCode);
    if (onDigest.length === 0 && onCode.length === 0) out.push("_No open comments._", "");
    return `${out.join("\n").trimEnd()}\n`;
}
