// `comments`, `resolve`, `note`, `mark`: typed writes to the comments and the config (in-process).
import { buildCommand } from "@stricli/core";
import { DigestError } from "../../lib/errors";
import { reviewMarkdown } from "../../lib/review";
import { CommentSchema, CommentsFileSchema, type Comment } from "../../lib/schemas";
import { localApi } from "../api";
import type { CliContext } from "../context";
import { emit, jsonFlag } from "../output";
import { OkOutputSchema, TextOutputSchema } from "../outputs";
import { resolveDigest } from "../ref";
import { idFlag, refFlag, refPositional, type RefFlags } from "./shared";

const STATUSES = ["open", "resolved", "note", "shared"] as const;

interface CommentsFlags extends RefFlags {
    readonly status: string;
    readonly markdown: boolean;
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

export const commentsCommand = buildCommand({
    docs: { brief: "Print the comments (default: open), or the open user comments as one Markdown comment" },
    parameters: {
        flags: {
            json: jsonFlag,
            id: idFlag,
            status: { kind: "parsed", parse: String, brief: `A comma list of ${STATUSES.join(", ")}`, default: "open" },
            markdown: {
                kind: "boolean",
                brief: "Print the open user comments as one Markdown comment",
                default: false,
            },
        },
        positional: refPositional,
    },
    async func(this: CliContext, flags: CommentsFlags, ref?: string) {
        const list = (): Promise<readonly Comment[]> =>
            localApi(this.home).comments.list({ id: resolveDigest({ ref, id: flags.id }, this).id });
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
    },
});

interface TargetedFlags extends RefFlags {
    readonly ref?: string;
}

export const resolveCommand = buildCommand({
    docs: { brief: "Mark a comment resolved, with a one-line reply" },
    parameters: {
        flags: { json: jsonFlag, id: idFlag, ref: refFlag },
        positional: {
            kind: "tuple",
            parameters: [
                { brief: "The comment id", parse: String, placeholder: "comment-id" },
                { brief: "The reply", parse: String, placeholder: "reply" },
            ],
        },
    },
    async func(this: CliContext, flags: TargetedFlags, commentId: string, reply: string) {
        await emit(this.out, { json: flags.json, schema: CommentSchema, text: c => `resolved ${c.id}` }, () => {
            const entry = resolveDigest({ ref: flags.ref, id: flags.id }, this);
            return localApi(this.home).comments.resolve({ id: entry.id, commentId, reply });
        });
    },
});

export const noteCommand = buildCommand({
    docs: { brief: "Add an agent note to the digest block that contains the text" },
    parameters: {
        flags: { json: jsonFlag, id: idFlag, ref: refFlag },
        positional: {
            kind: "tuple",
            parameters: [
                { brief: "Text from the block", parse: String, placeholder: "text" },
                { brief: "The note", parse: String, placeholder: "body" },
            ],
        },
    },
    async func(this: CliContext, flags: TargetedFlags, text: string, body: string) {
        await emit(this.out, { json: flags.json, schema: CommentSchema, text: c => `noted ${c.id}` }, () => {
            const entry = resolveDigest({ ref: flags.ref, id: flags.id }, this);
            return localApi(this.home).comments.note({ id: entry.id, text, body });
        });
    },
});

interface MarkFlags extends TargetedFlags {
    readonly off: boolean;
}

export const markCommand = buildCommand({
    docs: { brief: "List a file as generated in future digests for this repo (--off: review it again)" },
    parameters: {
        flags: {
            json: jsonFlag,
            id: idFlag,
            ref: refFlag,
            off: { kind: "boolean", brief: "Unmark the file", default: false },
        },
        positional: {
            kind: "tuple",
            parameters: [{ brief: "The repo-relative path", parse: String, placeholder: "path" }],
        },
    },
    async func(this: CliContext, flags: MarkFlags, path: string) {
        await emit(
            this.out,
            { json: flags.json, schema: OkOutputSchema, text: () => `${flags.off ? "unmarked" : "marked"} ${path}` },
            () => {
                const entry = resolveDigest({ ref: flags.ref, id: flags.id }, this);
                return localApi(this.home).files.setGenerated({ id: entry.id, path, on: !flags.off });
            },
        );
    },
});
