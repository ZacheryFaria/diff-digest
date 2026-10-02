// The envelope around a published body: a hidden marker (github) or YAML frontmatter (local).
// The body inside is the same for every backend and stays portable Markdown (spec product rule 2).
import { z } from "zod";
import { DigestError } from "../errors";
import { DigestMetaSchema, type DigestMeta } from "./types";

export const DIGEST_MARK = "<!-- diff-digest:";
export const REVIEW_MARK = "<!-- diff-digest-comments:";
const MARKER = /^<!-- diff-digest: (\{.*?\}) -->\n?/u;
const FOOTER = /\n*diff-digest · open locally: `[^`\n]*`\s*$/u;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/u;

function parseMeta(raw: unknown, where: string): DigestMeta {
    const result = DigestMetaSchema.safeParse(raw);
    if (!result.success)
        throw new DigestError(
            "BAD_INPUT",
            `The digest metadata in ${where} is not valid:\n${z.prettifyError(result.error)}`,
        );
    return result.data;
}

export function wrapMarker(body: string, meta: DigestMeta, footer: string): string {
    return `${DIGEST_MARK} ${JSON.stringify(meta)} -->\n${body.trim()}\n\n${footer}\n`;
}

export function unwrapMarker(text: string, where: string): { readonly body: string; readonly meta: DigestMeta } {
    const lf = text.replaceAll(/\r\n?/gu, "\n");
    const match = MARKER.exec(lf);
    if (match?.[1] === undefined) throw new DigestError("BAD_INPUT", `${where} has no diff-digest marker.`);
    let raw: unknown;
    try {
        raw = JSON.parse(match[1]);
    } catch (error) {
        throw new DigestError("BAD_INPUT", `The diff-digest marker in ${where} is not valid JSON.`, { cause: error });
    }
    return { body: `\n${lf.slice(match[0].length).replace(FOOTER, "").trim()}\n`, meta: parseMeta(raw, where) };
}

export function wrapFrontmatter(body: string, meta: DigestMeta, extra: Readonly<Record<string, unknown>>): string {
    const yaml = Bun.YAML.stringify({ ...extra, "diff-digest": meta }, null, 2).trimEnd();
    return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

export function unwrapFrontmatter(text: string, where: string): { readonly body: string; readonly meta: DigestMeta } {
    const lf = text.replaceAll(/\r\n?/gu, "\n");
    const match = FRONTMATTER.exec(lf);
    if (match?.[1] === undefined) throw new DigestError("BAD_INPUT", `${where} has no frontmatter.`);
    const data = z.looseObject({ "diff-digest": z.unknown() }).safeParse(Bun.YAML.parse(match[1]));
    if (!data.success) throw new DigestError("BAD_INPUT", `${where} has no diff-digest metadata.`);
    return { body: `\n${lf.slice(match[0].length).trim()}\n`, meta: parseMeta(data.data["diff-digest"], where) };
}
