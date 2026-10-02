// The results of publish and pull. Pure.
import { z } from "zod";
import { PublishedSchema } from "../backends/types";

export const PublishReportSchema = z
    .strictObject({
        results: z.array(PublishedSchema).readonly(),
        /** With dry run: the rendered body for each backend, and nothing is posted. */
        previews: z.array(z.strictObject({ backend: z.string(), text: z.string() }).readonly()).readonly(),
        /** Backends that had no place for the digest. */
        skipped: z.array(z.string()).readonly(),
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
    })
    .readonly();
export type PullReport = z.infer<typeof PullReportSchema>;

export const BackendInfoSchema = z.strictObject({ name: z.string(), type: z.enum(["github", "local"]) }).readonly();
