// `comments`, `resolve`, `note`, `mark`: typed writes to the comments and the config (in-process).
import { DigestError } from "../../lib/errors";
import { reviewMarkdown } from "../../lib/review";
import { CommentSchema, CommentsFileSchema, type Comment } from "../../lib/schemas";
import { localApi } from "../api";
import type { CliContext } from "../context";
import { emit } from "../output";
import { OkOutputSchema, TextOutputSchema } from "../outputs";
import { resolveDigest } from "../ref";
import { publishComments } from "./publish";
import { COMMENT_STATUSES as STATUSES, type RefFlags } from "./shared";

export interface CommentsFlags extends RefFlags {
    readonly status: string;
    readonly markdown: boolean;
    readonly publish: boolean;
    readonly to?: string;
}

function isStatus(value: string): value is Comment["status"] {
    return STATUSES.some(s => s === value);
}

/** The `--status` list. Each value must be a comment status. */
function parseStatuses(text: string): ReadonlySet<Comment["status"]> {
    const values = text.split(",").map(s => s.trim());
    const bad = values.filter(v => !isStatus(v));
    if (bad.length > 0)
        throw new DigestError("BAD_INPUT", `Not a comment status: ${bad.join(", ")}`, {
            hint: `Use a comma list of ${STATUSES.join(", ")}.`,
        });
    return new Set(values.filter(v => isStatus(v)));
}

function commentLine(c: Comment): string {
    const t = c.target;
    const lines = t.kind === "code" && t.endLine !== undefined && t.endLine !== t.line ? `-${t.endLine}` : "";
    const where = t.kind === "code" ? `${t.path}:${t.line}${lines}` : `“${t.text.slice(0, 60)}”`;
    return `${c.id}  ${c.status.padEnd(8)} ${c.author.padEnd(5)} ${where}\n    ${c.body.replaceAll("\n", "\n    ")}`;
}

export async function comments(this: CliContext, flags: CommentsFlags, ref?: string): Promise<void> {
    const list = (): Promise<readonly Comment[]> =>
        localApi(this.home).comments.list({ id: resolveDigest({ ref, id: flags.id }, this).id });
    if (flags.publish) {
        await publishComments.call(this, flags, ref);
        return;
    }
    if (flags.markdown) {
        await emit(this.out, { json: flags.json, schema: TextOutputSchema, text: t => t }, async () =>
            reviewMarkdown(await list()),
        );
        return;
    }
    await emit(
        this.out,
        {
            json: flags.json,
            schema: CommentsFileSchema,
            text: all => (all.length === 0 ? "No comments." : all.map(c => commentLine(c)).join("\n")),
        },
        async () => {
            const wanted = parseStatuses(flags.status);
            return (await list()).filter(c => wanted.has(c.status));
        },
    );
}

export interface TargetedFlags extends RefFlags {
    readonly ref?: string;
}

export async function resolve(this: CliContext, flags: TargetedFlags, commentId: string, reply: string): Promise<void> {
    await emit(this.out, { json: flags.json, schema: CommentSchema, text: c => `resolved ${c.id}` }, () => {
        const entry = resolveDigest({ ref: flags.ref, id: flags.id }, this);
        return localApi(this.home).comments.resolve({ id: entry.id, commentId, reply });
    });
}

export async function note(this: CliContext, flags: TargetedFlags, text: string, body: string): Promise<void> {
    await emit(this.out, { json: flags.json, schema: CommentSchema, text: c => `noted ${c.id}` }, () => {
        const entry = resolveDigest({ ref: flags.ref, id: flags.id }, this);
        return localApi(this.home).comments.note({ id: entry.id, text, body });
    });
}

export interface MarkFlags extends TargetedFlags {
    readonly off: boolean;
}

export async function mark(this: CliContext, flags: MarkFlags, path: string): Promise<void> {
    await emit(
        this.out,
        { json: flags.json, schema: OkOutputSchema, text: () => `${flags.off ? "unmarked" : "marked"} ${path}` },
        () => {
            const entry = resolveDigest({ ref: flags.ref, id: flags.id }, this);
            return localApi(this.home).files.setGenerated({ id: entry.id, path, on: !flags.off });
        },
    );
}
