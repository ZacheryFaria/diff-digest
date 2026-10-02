// Every command's output schema, by command name. `diff-digest schema <name>` prints one as JSON Schema.
import { z } from "zod";
import {
    BackendConfigSchema,
    ChangedFileSchema,
    CommentSchema,
    CommentsFileSchema,
    LintIssueSchema,
    ShaSchema,
} from "../lib/schemas";
import { PublishReportSchema, PullReportSchema } from "../lib/publish/schemas";
import { CheckResultSchema, RegistryEntrySchema, ServerInfoSchema, WaitResultSchema } from "../lib/schemas-api";
import { TargetSchema } from "./target";

export const TextOutputSchema = z.string();

export const ConfigOutputSchema = z
    .strictObject({
        path: z.string(),
        exists: z.boolean(),
        repoKeys: z.array(z.string()).readonly(),
        key: z.string().nullable(),
        backends: z.record(z.string(), BackendConfigSchema).readonly(),
        publishTo: z.array(z.string()).readonly(),
        generated: z.array(z.string()).readonly(),
    })
    .readonly();
export type ConfigOutput = z.infer<typeof ConfigOutputSchema>;

export const SchemaOutputSchema = z.unknown();

export const PathOutputSchema = z.strictObject({ path: z.string(), exists: z.boolean() }).readonly();

export const InitOutputSchema = z
    .strictObject({ id: z.string(), path: z.string(), created: z.boolean(), warnings: z.array(z.string()).readonly() })
    .readonly();

export const HunksOutputSchema = z
    .strictObject({
        base: ShaSchema,
        head: z.union([z.literal("worktree"), ShaSchema]),
        files: z
            .array(
                z
                    .strictObject({
                        ...ChangedFileSchema.unwrap().shape,
                        hunks: z
                            .array(z.strictObject({ start: z.int(), end: z.int(), size: z.int() }).readonly())
                            .readonly(),
                    })
                    .readonly(),
            )
            .readonly(),
        reviewableLines: z.int().nonnegative(),
    })
    .readonly();
export type HunksOutput = z.infer<typeof HunksOutputSchema>;

export const LintOutputSchema = z.array(LintIssueSchema).readonly();
export type LintOutput = z.infer<typeof LintOutputSchema>;

export const ExportOutputSchema = z.strictObject({ path: z.string() }).readonly();

export const ServeOutputSchema = z.strictObject({ url: z.string(), id: z.string(), pid: z.int() }).readonly();

export const ServerStatusOutputSchema = z
    .strictObject({
        running: z.boolean(),
        info: ServerInfoSchema.nullable(),
        digests: z.array(RegistryEntrySchema).readonly(),
    })
    .readonly();

export const StopOutputSchema = z.strictObject({ result: z.enum(["none", "stopped", "timeout"]) }).readonly();

export const OkOutputSchema = z.strictObject({ ok: z.literal(true) }).readonly();

export const FmtOutputSchema = z
    .strictObject({ path: z.string(), changed: z.boolean(), questions: z.array(z.string()).readonly() })
    .readonly();

export const OUTPUTS = {
    format: TextOutputSchema,
    prompt: TextOutputSchema,
    config: ConfigOutputSchema,
    schema: SchemaOutputSchema,
    target: TargetSchema,
    path: PathOutputSchema,
    init: InitOutputSchema,
    hunks: HunksOutputSchema,
    lint: LintOutputSchema,
    check: CheckResultSchema,
    fmt: FmtOutputSchema,
    comments: CommentsFileSchema,
    resolve: CommentSchema,
    note: CommentSchema,
    mark: OkOutputSchema,
    serve: ServeOutputSchema,
    export: ExportOutputSchema,
    publish: PublishReportSchema,
    pull: PullReportSchema,
    wait: WaitResultSchema,
    "server status": ServerStatusOutputSchema,
    "server stop": StopOutputSchema,
    "server restart": ServerStatusOutputSchema,
    "server logs": TextOutputSchema,
} as const;

export type CommandName = keyof typeof OUTPUTS;

export function isCommandName(name: string): name is CommandName {
    return Object.hasOwn(OUTPUTS, name);
}
