// The HTTP contract (spec §7). The server implements it; the CLI and the UI call it. Pure.
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import { CommentSchema, CommentsFileSchema, CommentTargetSchema, LintIssueSchema } from "./schemas";
import {
    ActionStatusSchema,
    ActionTypeSchema,
    CheckResultSchema,
    DiffPayloadSchema,
    DigestPayloadSchema,
    FilePayloadSchema,
    FileSideSchema,
    ServerEventSchema,
    WaitResultSchema,
} from "./schemas-api";

const IdSchema = z.strictObject({ id: z.string().min(1) }).readonly();
const OkSchema = z.strictObject({ ok: z.literal(true) }).readonly();
const PathSchema = z.strictObject({ id: z.string().min(1), path: z.string().min(1) }).readonly();
const CommentRefSchema = z.strictObject({ id: z.string().min(1), commentId: z.string().min(1) }).readonly();
/** The longest `actions.wait`: just under the 2-hour limit of a Claude Code background task. */
export const MAX_WAIT_MS = 6_900_000;

export const contract = {
    digest: {
        get: oc.input(IdSchema).output(DigestPayloadSchema),
        lint: oc.input(IdSchema).output(z.array(LintIssueSchema).readonly()),
        check: oc.input(IdSchema).output(CheckResultSchema),
    },
    files: {
        diff: oc.input(PathSchema).output(DiffPayloadSchema),
        read: oc
            .input(z.strictObject({ id: z.string().min(1), path: z.string().min(1), rev: FileSideSchema }).readonly())
            .output(FilePayloadSchema),
        setGenerated: oc
            .input(z.strictObject({ id: z.string().min(1), path: z.string().min(1), on: z.boolean() }).readonly())
            .output(OkSchema),
    },
    comments: {
        list: oc.input(IdSchema).output(CommentsFileSchema),
        add: oc
            .input(
                z
                    .strictObject({ id: z.string().min(1), target: CommentTargetSchema, body: z.string().min(1) })
                    .readonly(),
            )
            .output(CommentSchema),
        remove: oc.input(CommentRefSchema).output(OkSchema),
        resolve: oc
            .input(
                z.strictObject({ id: z.string().min(1), commentId: z.string().min(1), reply: z.string() }).readonly(),
            )
            .output(CommentSchema),
        /** An agent note on the digest block that contains `text`. */
        note: oc
            .input(
                z.strictObject({ id: z.string().min(1), text: z.string().min(1), body: z.string().min(1) }).readonly(),
            )
            .output(CommentSchema),
        markShared: oc
            .input(
                z
                    .strictObject({
                        id: z.string().min(1),
                        commentIds: z.array(z.string().min(1)).readonly(),
                        ref: z.string().min(1),
                    })
                    .readonly(),
            )
            .output(CommentsFileSchema),
    },
    actions: {
        send: oc
            .input(z.strictObject({ id: z.string().min(1), type: ActionTypeSchema }).readonly())
            .output(ActionStatusSchema),
        wait: oc
            .input(z.strictObject({ id: z.string().min(1), timeoutMs: z.int().positive().max(MAX_WAIT_MS) }).readonly())
            .output(WaitResultSchema),
        status: oc.input(IdSchema).output(ActionStatusSchema),
    },
    events: oc.input(IdSchema).output(eventIterator(ServerEventSchema)),
};

export type Contract = typeof contract;
