// Pull requests: parse a PR reference, read its info with gh, find a branch's PR, fetch its commits.
import { z } from "zod";
import { DigestError } from "../errors";
import { hasCommit, originRepo, runGit, short, type OriginRepo } from "../repo";
import { ShaSchema } from "../schemas";
import { ghJson } from "./gh";
import type { BackendDeps, PrInfo, PrRef } from "./types";

export type { PrRef } from "./types";

/** A PR URL. A tail (`/files`, `#issuecomment-1`, `?x=1`) is allowed. */
const PR_URL = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/u;
const PR_NUMBER = /^#?(\d+)$/u;
const NAME = /^[\w.-]+$/u;

/** A PR URL, or null. The owner and the repo must be GitHub names. */
export function parsePrUrl(arg: string): PrRef | null {
    const url = PR_URL.exec(arg);
    if (url === null) return null;
    const [, host = "", owner = "", repo = "", n = "0"] = url;
    if (![owner, repo].every(name => NAME.test(name) && name !== "." && name !== "..")) return null;
    return { host, owner, repo, number: Number(n) };
}

/** A PR URL, or `#123` / `123` for the origin repo. Null when `arg` is not a PR reference. */
export function parsePrRef(arg: string, root: string): PrRef | null {
    const url = parsePrUrl(arg);
    if (url !== null) return url;
    const num = PR_NUMBER.exec(arg);
    if (num === null) return null;
    const origin = originRepo(root);
    if (origin === null)
        throw new DigestError("NOT_FOUND", "The repo has no origin remote, so a PR number has no repo.", {
            hint: "Give the PR URL.",
        });
    return { ...origin, number: Number(num[1]) };
}

const PullSchema = z
    .looseObject({
        html_url: z.string(),
        title: z.string(),
        state: z.string(),
        base: z.looseObject({ ref: z.string(), sha: ShaSchema }),
        head: z.looseObject({ ref: z.string(), sha: ShaSchema }),
    })
    .readonly();

export function prInfo(deps: BackendDeps, ref: PrRef, cwd: string): PrInfo {
    const pull = ghJson(
        deps,
        { host: ref.host, cwd, args: ["api", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`] },
        PullSchema,
    );
    return {
        ...ref,
        url: pull.html_url,
        title: pull.title,
        state: pull.state,
        baseRef: pull.base.ref,
        baseSha: pull.base.sha,
        headRef: pull.head.ref,
        headSha: pull.head.sha,
    };
}

const PrListSchema = z.array(z.looseObject({ number: z.int().positive() })).readonly();

/** The open PR whose head is `branch`, or null (also null when the repo has no origin). */
export function findPrForBranch(deps: BackendDeps, root: string, branch: string): PrInfo | null {
    const origin = originRepo(root);
    if (origin === null || branch === "") return null;
    const list = ghJson(
        deps,
        {
            host: origin.host,
            cwd: root,
            args: [
                "pr",
                "list",
                "--repo",
                `${origin.host}/${origin.owner}/${origin.repo}`,
                "--head",
                branch,
                "--state",
                "open",
                "--json",
                "number",
                "--limit",
                "1",
            ],
        },
        PrListSchema,
    );
    const first = list[0];
    return first === undefined ? null : prInfo(deps, { ...origin, number: first.number }, root);
}

function repoKey(r: OriginRepo): string {
    return `${r.host}/${r.owner}/${r.repo}`.toLowerCase();
}

/** `origin` when the PR is in the origin repo, else the PR repo's URL. GitHub names ignore case. */
export function remoteFor(root: string, pr: OriginRepo): string {
    const origin = originRepo(root);
    const same = origin !== null && repoKey(origin) === repoKey(pr);
    return same ? "origin" : `https://${pr.host}/${pr.owner}/${pr.repo}.git`;
}

/** Fetches the PR head and base commits when the clone does not have them. */
export function ensurePrCommits(root: string, pr: PrInfo): void {
    const remote = remoteFor(root, pr);
    if (!hasCommit(root, pr.headSha)) runGit(root, ["fetch", "-q", remote, `pull/${pr.number}/head`]);
    if (!hasCommit(root, pr.baseSha)) runGit(root, ["fetch", "-q", remote, pr.baseRef]);
    for (const sha of [pr.headSha, pr.baseSha]) {
        if (!hasCommit(root, sha))
            throw new DigestError("BACKEND_FAILED", `Could not fetch commit ${short(sha)} from ${remote}.`);
    }
}
