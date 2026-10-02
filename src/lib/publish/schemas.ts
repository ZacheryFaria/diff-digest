// The results of publish and pull. Pure.
import { z } from "zod";
import { PublishedSchema } from "../backends/types";
import { ERROR_CODES } from "../errors";

export const BackendFailureSchema = z
    .strictObject({ backend: z.string(), code: z.enum(ERROR_CODES), message: z.string() })
    .readonly();
export type BackendFailure = z.infer<typeof BackendFailureSchema>;

export const PublishReportSchema = z
    .strictObject({
        results: z.array(PublishedSchema).readonly(),
        /** With dry run: the rendered body for each backend, and nothing is posted. */
        previews: z.array(z.strictObject({ backend: z.string(), text: z.string() }).readonly()).readonly(),
        /** Backends that had no place for the digest. */
        skipped: z.array(z.string()).readonly(),
        /** Backends that failed. The other backends still published. */
        errors: z.array(BackendFailureSchema).readonly(),
    })
    .readonly();
export type PublishReport = z.infer<typeof PublishReportSchema>;

export const PullReportSchema = z
    .strictObject({
        path: z.string(),
        backend: z.string(),
        ref: z.string(),
        /** True when the pulled digest is for another head than the target's head. */
        stale: z.boolean(),
        /** True when the pulled digest's head commit is not in the clone, so the copy is pinned to the target head. */
        headMissing: z.boolean(),
    })
    .readonly();
export type PullReport = z.infer<typeof PullReportSchema>;

export const BackendInfoSchema = z.strictObject({ name: z.string(), type: z.enum(["github", "local"]) }).readonly();
