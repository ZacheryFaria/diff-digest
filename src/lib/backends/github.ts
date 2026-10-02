// The github backend: the digest is one PR comment (updated in place); each review is a new comment.
import { z } from "zod";
import { DigestError } from "../errors";
import { unrenderLinks } from "../render";
import { DIGEST_MARK, markerJson, REVIEW_MARK, unwrapMarker, wrapMarker } from "./envelope";
import { gh, ghJson } from "./gh";
import { findPrForBranch, prInfo } from "./pr";
import type { Backend, BackendDeps, DigestMeta, Location, PrInfo, Published } from "./types";

export const COMMENT_LIMIT = 65_536;

const CommentSchema = z.looseObject({ id: z.int(), html_url: z.string(), body: z.string() }).readonly();
type GhComment = z.infer<typeof CommentSchema>;

function prOf(location: Location): PrInfo {
    if (location.type !== "github") throw new DigestError("BAD_INPUT", "The github backend got a local location.");
    return location.pr;
}

/** The last comment on the PR whose body starts with `mark`. */
export function findComment(deps: BackendDeps, pr: PrInfo, mark: string): GhComment | null {
    const out = gh(deps, {
        host: pr.host,
        cwd: ".",
        args: [
            "api",
            "--paginate",
            `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
            "--jq",
            `.[] | select(.body | startswith(${JSON.stringify(mark)})) | {id, html_url, body}`,
        ],
    });
    const hits = out
        .split("\n")
        .filter(l => l.trim() !== "")
        .map(l => parseComment(l));
    return hits.at(-1) ?? null;
}

function parseComment(line: string): GhComment {
    let raw: unknown;
    try {
        raw = JSON.parse(line);
    } catch (error) {
        throw new DigestError("BACKEND_FAILED", "gh returned a comment line that is not JSON.", { cause: error });
    }
    const result = CommentSchema.safeParse(raw);
    if (!result.success)
        throw new DigestError("BACKEND_FAILED", `gh returned an unexpected comment:\n${z.prettifyError(result.error)}`);
    return result.data;
}

function post(deps: BackendDeps, pr: PrInfo, body: string, existing: number | null): GhComment {
    const path =
        existing === null
            ? `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`
            : `repos/${pr.owner}/${pr.repo}/issues/comments/${existing}`;
    return ghJson(
        deps,
        {
            host: pr.host,
            cwd: ".",
            args: ["api", "-X", existing === null ? "POST" : "PATCH", path, "--input", "-"],
            input: JSON.stringify({ body }),
        },
        CommentSchema,
    );
}

function checkSize(text: string): void {
    if (text.length > COMMENT_LIMIT) {
        throw new DigestError(
            "BAD_INPUT",
            `The comment is ${text.length} characters. GitHub allows ${COMMENT_LIMIT}.`,
            { hint: "Make the digest shorter." },
        );
    }
}

/** The comment text for a digest: the marker, the body, and a footer with the command to open it. */
export function githubEnvelope(pr: PrInfo, body: string, meta: DigestMeta): string {
    return wrapMarker(body, meta, `diff-digest · open locally: \`/diff-digest ${pr.url}\``);
}

/** gh says the comment is gone or not ours to change. */
const GONE = /HTTP 40[34]/u;

/** Updates the digest comment, or posts a new one when it cannot be updated (deleted, or not ours). */
function postDigest(
    deps: BackendDeps,
    pr: PrInfo,
    text: string,
): { readonly comment: GhComment; readonly updated: boolean; readonly warnings: readonly string[] } {
    const existing = findComment(deps, pr, DIGEST_MARK);
    if (existing === null) return { comment: post(deps, pr, text, null), updated: false, warnings: [] };
    try {
        return { comment: post(deps, pr, text, existing.id), updated: true, warnings: [] };
    } catch (error) {
        if (!(error instanceof DigestError) || !GONE.test(error.message)) throw error;
        const warning = `Could not update ${existing.html_url}, so a new comment is posted.`;
        return { comment: post(deps, pr, text, null), updated: false, warnings: [warning] };
    }
}

function publishGithub(deps: BackendDeps, name: string, pr: PrInfo, body: string, meta: DigestMeta): Published {
    const text = githubEnvelope(pr, body, meta);
    checkSize(text);
    const { comment, updated, warnings } = postDigest(deps, pr, text);
    const stale = meta.head !== null && meta.head !== pr.headSha;
    const staleWarning = `The digest is for ${meta.head?.slice(0, 11) ?? ""}, but the PR head is ${pr.headSha.slice(0, 11)}.`;
    return { backend: name, ref: comment.html_url, updated, warnings: stale ? [...warnings, staleWarning] : warnings };
}

/** Runs `run` in a promise, so a thrown error becomes a rejection. */
function attempt<T>(run: () => T): Promise<T> {
    return Promise.resolve().then(run);
}

/** Each path segment URL-encoded (a `#` or `?` in a file name stays part of the path). */
function encodePath(path: string): string {
    return path
        .split("/")
        .map(s => encodeURIComponent(s))
        .join("/");
}

export function createGithubBackend(name: string, deps: BackendDeps): Backend {
    return {
        name,
        type: "github",
        locate: input =>
            attempt(() => {
                const ref = input.prRef ?? null;
                const pr =
                    input.pr ??
                    (ref === null ? findPrForBranch(deps, input.root, input.branch) : prInfo(deps, ref, input.root));
                return pr === null ? null : ({ type: "github", pr } as const);
            }),
        envelope: (location, body, meta) =>
            attempt(() => {
                const text = githubEnvelope(prOf(location), body, meta);
                checkSize(text);
                return text;
            }),
        publish: (location, body, meta) => attempt(() => publishGithub(deps, name, prOf(location), body, meta)),
        publishReview: (location, review, head) =>
            attempt(() => {
                const pr = prOf(location);
                const text = `${REVIEW_MARK} ${markerJson({ v: 1, head })} -->\n${review}`;
                checkSize(text);
                return { backend: name, ref: post(deps, pr, text, null).html_url, updated: false, warnings: [] };
            }),
        pull: location =>
            attempt(() => {
                const found = findComment(deps, prOf(location), DIGEST_MARK);
                if (found === null) return null;
                const { body, meta } = unwrapMarker(found.body, found.html_url);
                return { body: unrenderLinks(body), meta, ref: found.html_url };
            }),
        anchorLink: (anchor, ctx) => {
            const path = ctx.resolvePath(anchor.path);
            if (path === null || ctx.pr === null) return null;
            const lines = anchor.end === anchor.start ? `L${anchor.start}` : `L${anchor.start}-L${anchor.end}`;
            return `https://${ctx.pr.host}/${ctx.pr.owner}/${ctx.pr.repo}/blob/${ctx.head}/${encodePath(path)}#${lines}`;
        },
    };
}
