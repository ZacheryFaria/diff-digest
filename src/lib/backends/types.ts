// The backend interface (spec §5.3). A backend stores published digests and reviews somewhere.
import { z } from "zod";
import type { Anchor } from "../digest";
import { ShaSchema } from "../schemas";

/** What the envelope stores next to a published body, so `pull` can rebuild the working copy. */
export const DigestMetaSchema = z
    .strictObject({
        v: z.literal(1),
        id: z.string().regex(/^[0-9a-z]{8}$/u),
        branch: z.string(),
        base: ShaSchema,
        head: ShaSchema.nullable(),
    })
    .readonly();
export type DigestMeta = z.infer<typeof DigestMetaSchema>;

export const PrInfoSchema = z
    .strictObject({
        host: z.string().min(1),
        owner: z.string().min(1),
        repo: z.string().min(1),
        number: z.int().positive(),
        url: z.string().min(1),
        title: z.string(),
        state: z.string(),
        baseRef: z.string(),
        baseSha: ShaSchema,
        headRef: z.string(),
        headSha: ShaSchema,
    })
    .readonly();
export type PrInfo = z.infer<typeof PrInfoSchema>;

export const PublishedSchema = z
    .strictObject({
        backend: z.string(),
        /** A URL (github) or a file path (local). */
        ref: z.string(),
        updated: z.boolean(),
        warnings: z.array(z.string()).readonly(),
    })
    .readonly();
export type Published = z.infer<typeof PublishedSchema>;

export type Location =
    | { readonly type: "github"; readonly pr: PrInfo }
    | { readonly type: "local"; readonly digestPath: string; readonly reviewPath: string; readonly repo: string };

/** What a backend needs to find where a digest goes. */
export interface LocateInput {
    readonly root: string;
    /** The repo name (the first config key). */
    readonly repo: string;
    /** The working copy name. */
    readonly name: string;
    readonly branch: string;
    /** The PR, when the target is a PR or the branch has an open PR. */
    readonly pr: PrInfo | null;
}

export interface LinkContext {
    readonly root: string;
    /** The commit that links point at. */
    readonly head: string;
    /** The full repo path for an anchor path suffix, or null. */
    readonly resolvePath: (suffix: string) => string | null;
    /** The PR that the digest is published to (github links need its repo). */
    readonly pr: PrInfo | null;
}

export interface Pulled {
    /** The body with the links removed. */
    readonly body: string;
    readonly meta: DigestMeta;
    readonly ref: string;
}

export interface Backend {
    readonly name: string;
    readonly type: "github" | "local";
    /** Where the digest goes, or null when this backend cannot take it (for example github without a PR). */
    readonly locate: (input: LocateInput) => Promise<Location | null>;
    readonly publish: (location: Location, body: string, meta: DigestMeta) => Promise<Published>;
    readonly publishReview: (location: Location, review: string, head: string) => Promise<Published>;
    readonly pull: (location: Location) => Promise<Pulled | null>;
    readonly anchorLink: (anchor: Anchor, ctx: LinkContext) => string | null;
}

export interface ExecResult {
    readonly ok: boolean;
    readonly stdout: string;
    readonly stderr: string;
}

/** The outside world for a backend. Tests replace it. */
export interface BackendDeps {
    readonly exec: (
        command: string,
        args: readonly string[],
        options: { readonly cwd: string; readonly input?: string; readonly env?: Readonly<Record<string, string>> },
    ) => ExecResult;
    readonly readFile: (path: string) => string | null;
    readonly writeFile: (path: string, data: string) => void;
}
