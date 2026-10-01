import { z } from "zod";

// Naming: each schema is `XSchema`, and its type is `X`. The schemas are `.readonly()`, so the
// inferred types are deeply readonly. Build new values; do not change parsed values.

declare const shaBrand: unique symbol;
/** A full 40-character commit or tree id. */
export type Sha = string & { readonly [shaBrand]: true };

const SHA = /^[0-9a-f]{40}$/u;

export function isSha(value: unknown): value is Sha {
    return typeof value === "string" && SHA.test(value);
}

export const ShaSchema = z.custom<Sha>(isSha, { message: "Expected a full 40-character sha" });

const RegexSchema = z.string().refine(
    value => {
        try {
            return new RegExp(value, "u").source.length > 0;
        } catch {
            return false;
        }
    },
    { message: "Not a valid regular expression" },
);

// ---- diff ----

export const FileStatusSchema = z.enum(["A", "M", "D", "R", "C", "T", "U"]);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const FileClassSchema = z.enum(["source", "test", "generated", "binary"]);
export type FileClass = z.infer<typeof FileClassSchema>;

export const ChangedFileSchema = z
    .strictObject({
        status: FileStatusSchema,
        path: z.string().min(1),
        oldPath: z.string().min(1),
        cls: FileClassSchema,
        untracked: z.boolean(),
    })
    .readonly();
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const DiffLineSchema = z.strictObject({ n: z.int().nonnegative(), text: z.string() }).readonly();
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const HunkSchema = z
    .strictObject({
        start: z.int().positive(),
        end: z.int().positive(),
        oldStart: z.int().nonnegative(),
        oldCount: z.int().nonnegative(),
        newStart: z.int().nonnegative(),
        newCount: z.int().nonnegative(),
        removed: z.array(DiffLineSchema).readonly(),
        added: z.array(DiffLineSchema).readonly(),
        size: z.int().nonnegative(),
    })
    .readonly();
export type Hunk = z.infer<typeof HunkSchema>;

// ---- config file (~/.diff-digest/config.json) ----

const GithubBackendConfigSchema = z.strictObject({ type: z.literal("github") });

const LocalBackendConfigSchema = z.strictObject({
    type: z.literal("local"),
    dir: z.string().min(1),
    linkTemplate: z.string().optional(),
    frontmatter: z.record(z.string(), z.unknown()).readonly().optional(),
});

export const BackendConfigSchema = z
    .discriminatedUnion("type", [GithubBackendConfigSchema, LocalBackendConfigSchema])
    .readonly();
export type BackendConfig = z.infer<typeof BackendConfigSchema>;

export const RepoConfigSchema = z
    .strictObject({
        generated: z.array(RegexSchema).readonly().optional(),
        publishTo: z.array(z.string().min(1)).readonly().optional(),
    })
    .readonly();
export type RepoConfig = z.infer<typeof RepoConfigSchema>;

/** The config file as it is on disk. Every key is optional; `resolveConfig` fills in the defaults. */
export const ConfigFileSchema = z
    .strictObject({
        backends: z.record(z.string().min(1), BackendConfigSchema).readonly().optional(),
        publishTo: z.array(z.string().min(1)).readonly().optional(),
        generated: z.array(RegexSchema).readonly().optional(),
        repos: z.record(z.string().min(1), RepoConfigSchema).readonly().optional(),
    })
    .readonly();
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

// ---- digest frontmatter (tool-owned) ----

export const FrontmatterSchema = z
    .strictObject({
        id: z.string().regex(/^[0-9a-z]{8}$/u),
        branch: z.string(),
        base: ShaSchema,
        /** null: the head is the working tree. */
        head: ShaSchema.nullable(),
        pinned: z.boolean(),
        meta: z.record(z.string(), z.unknown()).readonly(),
    })
    .readonly();
export type Frontmatter = z.infer<typeof FrontmatterSchema>;

// ---- comments (<name>.comments.json) ----

const DigestTargetSchema = z.strictObject({
    kind: z.literal("digest"),
    cid: z.string().min(1),
    section: z.string(),
    text: z.string(),
});

const CodeTargetSchema = z
    .strictObject({
        kind: z.literal("code"),
        path: z.string().min(1),
        rev: z.enum(["base", "head"]),
        line: z.int().positive(),
        endLine: z.int().positive().optional(),
        text: z.string(),
    })
    .refine(t => t.endLine === undefined || t.endLine >= t.line, { message: "endLine must not be before line" });

export const CommentTargetSchema = z.discriminatedUnion("kind", [DigestTargetSchema, CodeTargetSchema]).readonly();
export type CommentTarget = z.infer<typeof CommentTargetSchema>;

export const CommentSchema = z
    .strictObject({
        id: z.string().min(1),
        created: z.iso.datetime(),
        author: z.enum(["user", "agent"]),
        status: z.enum(["open", "resolved", "note", "shared"]),
        target: CommentTargetSchema,
        body: z.string().min(1),
        reply: z.string().optional(),
        /** Where a shared comment was posted (for example a PR comment URL). */
        ref: z.string().optional(),
    })
    .readonly();
export type Comment = z.infer<typeof CommentSchema>;

export const CommentsFileSchema = z.array(CommentSchema).readonly();
