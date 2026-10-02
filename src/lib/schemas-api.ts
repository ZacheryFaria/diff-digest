// Schemas for the server, its payloads, and its events (spec §7). Pure: the UI imports this file.
import { z } from "zod";
import {
    ChangedFileSchema,
    CommentsFileSchema,
    DiffLineSchema,
    FrontmatterSchema,
    LintIssueSchema,
    ShaSchema,
} from "./schemas";

// ---- server ----

export const RegistryEntrySchema = z
    .strictObject({
        id: z.string().regex(/^[0-9a-z]{8}$/u),
        mdPath: z.string().min(1),
        /** The repo root that the digest's base and head belong to. */
        root: z.string().min(1),
        updatedAt: z.iso.datetime(),
    })
    .readonly();
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export const RegistryFileSchema = z
    .strictObject({ digests: z.record(z.string(), RegistryEntrySchema).readonly() })
    .readonly();
export type RegistryFile = z.infer<typeof RegistryFileSchema>;

export const ServerInfoSchema = z
    .strictObject({
        pid: z.int().positive(),
        port: z.int().positive(),
        version: z.string().min(1),
        startedAt: z.iso.datetime(),
    })
    .readonly();
export type ServerInfo = z.infer<typeof ServerInfoSchema>;

// ---- payloads (server → UI and CLI) ----

export const MarkedFileSchema = z.strictObject({ ...ChangedFileSchema.unwrap().shape, marked: z.boolean() }).readonly();
export type MarkedFile = z.infer<typeof MarkedFileSchema>;

export const DigestPayloadSchema = z
    .strictObject({
        id: z.string(),
        body: z.string(),
        /** The number of file lines before the body (the frontmatter), so body lines map to file lines. */
        lineOffset: z.int().nonnegative(),
        frontmatter: FrontmatterSchema,
        files: z.array(MarkedFileSchema).readonly(),
        /** The head commit, or null for a working tree with no commits. */
        head: ShaSchema.nullable(),
        stats: z
            .strictObject({
                files: z.int().nonnegative(),
                generated: z.int().nonnegative(),
                diffLines: z.int().nonnegative(),
                digestLines: z.int().nonnegative(),
            })
            .readonly(),
    })
    .readonly();
export type DigestPayload = z.infer<typeof DigestPayloadSchema>;

export const DiffPayloadSchema = z
    .strictObject({ path: z.string(), oldPath: z.string(), text: z.string(), unchanged: z.boolean() })
    .readonly();
export type DiffPayload = z.infer<typeof DiffPayloadSchema>;

export const LineMarkSchema = z.enum(["added", "changed", "removed", "deleted-after"]);
export type LineMark = z.infer<typeof LineMarkSchema>;

export const HunkSummarySchema = z
    .strictObject({
        oldStart: z.int().nonnegative(),
        oldCount: z.int().nonnegative(),
        newStart: z.int().nonnegative(),
        newCount: z.int().nonnegative(),
        added: z.array(z.int().nonnegative()).readonly(),
        removed: z.array(DiffLineSchema).readonly(),
    })
    .readonly();
export type HunkSummary = z.infer<typeof HunkSummarySchema>;

export const FileSideSchema = z.enum(["base", "head"]);
export type FileSide = z.infer<typeof FileSideSchema>;

export const FilePayloadSchema = z
    .strictObject({
        path: z.string(),
        oldPath: z.string(),
        rev: FileSideSchema,
        text: z.string(),
        /** Line number (as a string key) → mark. */
        marks: z.record(z.string(), LineMarkSchema).readonly(),
        hunks: z.array(HunkSummarySchema).readonly(),
        unchanged: z.boolean(),
        error: z.string().optional(),
    })
    .readonly();
export type FilePayload = z.infer<typeof FilePayloadSchema>;

export const CheckResultSchema = z
    .strictObject({ issues: z.array(LintIssueSchema).readonly(), gaps: z.array(z.string()).readonly() })
    .readonly();
export type CheckResult = z.infer<typeof CheckResultSchema>;

// ---- actions and events ----

export const ActionTypeSchema = z.enum(["apply", "review"]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionSchema = z
    .strictObject({
        type: ActionTypeSchema,
        id: z.string(),
        mdPath: z.string(),
        /** The open user comments when the button was clicked. */
        comments: CommentsFileSchema,
    })
    .readonly();
export type Action = z.infer<typeof ActionSchema>;

export const WaitResultSchema = z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("action"), action: ActionSchema }).readonly(),
    z.strictObject({ type: z.literal("timeout") }).readonly(),
]);
export type WaitResult = z.infer<typeof WaitResultSchema>;

export const ActionStatusSchema = z
    .strictObject({ listening: z.int().nonnegative(), queued: z.int().nonnegative() })
    .readonly();
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ServerEventSchema = z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("digest") }).readonly(),
    z.strictObject({ type: z.literal("comments") }).readonly(),
    z.strictObject({ type: z.literal("status"), status: ActionStatusSchema }).readonly(),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
