import { describe, expect, test } from "bun:test";
import { createGithubBackend, COMMENT_LIMIT } from "../../../src/lib/backends/github";
import { parsePrRef, prInfo } from "../../../src/lib/backends/pr";
import type { DigestMeta, LinkContext, PrInfo } from "../../../src/lib/backends/types";
import { ShaSchema } from "../../../src/lib/schemas";
import { fakeDeps, type FakeCall } from "../../helpers/backend";
import { expectDigestError, makeRepo } from "../../helpers/repo";

const HEAD = "b".repeat(40);
const META: DigestMeta = {
    v: 1,
    id: "abcd1234",
    branch: "zf/x",
    base: ShaSchema.parse("a".repeat(40)),
    head: ShaSchema.parse(HEAD),
};
const BODY = "\n# Title\n\n- see `a.ts:3`\n";
const PULL = {
    html_url: "https://gh.dev/o/r/pull/7",
    title: "T",
    state: "open",
    base: { ref: "main", sha: "a".repeat(40) },
    head: { ref: "zf/x", sha: HEAD },
};

function ok(stdout: string): { ok: true; stdout: string; stderr: string } {
    return { ok: true, stdout, stderr: "" };
}

/** A fake `gh` that keeps the PR's comments in memory. */
function fakeGh(patchFails = false): {
    deps: ReturnType<typeof fakeDeps>["deps"];
    comments: { id: number; html_url: string; body: string }[];
    calls: FakeCall[];
} {
    const comments: { id: number; html_url: string; body: string }[] = [];
    const { deps, calls } = fakeDeps(call => {
        const a = call.args;
        if (a[0] === "api" && a[1] === "repos/o/r/pulls/7") return ok(JSON.stringify(PULL));
        if (a[0] === "pr") return ok(JSON.stringify([{ number: 7 }]));
        if (a[1] === "--paginate") {
            const mark = String(a[4]).match(/startswith\((".*?")\)/u)?.[1] ?? '""';
            const prefix: unknown = JSON.parse(mark);
            return ok(
                comments
                    .filter(c => typeof prefix === "string" && c.body.startsWith(prefix))
                    .map(c => JSON.stringify(c))
                    .join("\n"),
            );
        }
        const parsed: unknown = JSON.parse(call.input ?? "{}");
        const body =
            typeof parsed === "object" && parsed !== null && "body" in parsed && typeof parsed.body === "string"
                ? parsed.body
                : "";
        if (a[2] === "POST") {
            const c = { id: comments.length + 1, html_url: `https://gh.dev/o/r/pull/7#c${comments.length + 1}`, body };
            comments.push(c);
            return ok(JSON.stringify(c));
        }
        if (patchFails) return { ok: false, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
        const id = Number(String(a[3]).split("/").at(-1));
        const existing = comments.find(c => c.id === id);
        if (existing === undefined) return { ok: false, stdout: "", stderr: "404" };
        existing.body = body;
        return ok(JSON.stringify(existing));
    });
    return { deps, comments, calls };
}

describe("pr references", () => {
    test("parses URLs and numbers, and nothing else", () => {
        const repo = makeRepo();
        try {
            expect(parsePrRef("https://gh.dev/o/r/pull/7", repo.root)).toEqual({
                host: "gh.dev",
                owner: "o",
                repo: "r",
                number: 7,
            });
            expect(parsePrRef("1f0f95a", repo.root)).toBeNull();
            expect(parsePrRef("123-fix", repo.root)).toBeNull();
            expectDigestError(() => parsePrRef("#7", repo.root), "NOT_FOUND");
        } finally {
            repo.remove();
        }
    });

    test("a PR URL can have a tail; the owner and the repo must be names", () => {
        const pr = { host: "gh.dev", owner: "o", repo: "r.js", number: 12 };
        for (const tail of ["", "/", "/files", "#issuecomment-1", "?x=1", "/commits/abc"])
            expect(parsePrRef(`https://gh.dev/o/r.js/pull/12${tail}`, ".")).toEqual(pr);
        expect(parsePrRef("https://gh.dev/o/r/pull/12x", ".")).toBeNull();
        expect(parsePrRef("https://gh.dev/o%20x/r/pull/12", ".")).toBeNull();
        expect(parsePrRef("https://gh.dev/o/r:x/pull/12", ".")).toBeNull();
    });

    test("prInfo reads the PR through gh", () => {
        const { deps } = fakeGh();
        expect(prInfo(deps, { host: "gh.dev", owner: "o", repo: "r", number: 7 }, ".")).toMatchObject({
            headSha: HEAD,
            headRef: "zf/x",
            url: PULL.html_url,
        });
    });
});

describe("github backend", () => {
    test("publishes one digest comment, updates it, pulls it back, and posts reviews as new comments", async () => {
        const { deps, comments } = fakeGh();
        const backend = createGithubBackend("github", deps);
        const pr: PrInfo = prInfo(deps, { host: "gh.dev", owner: "o", repo: "r", number: 7 }, ".");
        const loc = await backend.locate({ root: ".", repo: "r", name: "zf-x", branch: "zf/x", pr });
        if (loc === null) throw new Error("no location");
        expect(await backend.publish(loc, BODY, META)).toMatchObject({ updated: false, warnings: [] });
        expect(await backend.publish(loc, BODY, META)).toMatchObject({ updated: true });
        expect(comments).toHaveLength(1);
        expect(comments[0]?.body).toStartWith("<!-- diff-digest: ");
        expect(comments[0]?.body).toContain("diff-digest · open locally: `/diff-digest https://gh.dev/o/r/pull/7`");
        expect(await backend.pull(loc)).toMatchObject({ body: BODY, meta: META });
        await backend.publishReview(loc, "### Comments\n", HEAD);
        await backend.publishReview(loc, "### Comments\n", HEAD);
        expect(comments).toHaveLength(3);
    });

    test("warns when the digest head is not the PR head, and refuses a body over the limit", async () => {
        const { deps } = fakeGh();
        const backend = createGithubBackend("github", deps);
        const pr = prInfo(deps, { host: "gh.dev", owner: "o", repo: "r", number: 7 }, ".");
        const loc = { type: "github", pr } as const;
        const old = { ...META, head: ShaSchema.parse("c".repeat(40)) };
        expect((await backend.publish(loc, BODY, old)).warnings).toHaveLength(1);
        const huge = `\n# T\n\n${"x".repeat(COMMENT_LIMIT)}\n`;
        const failure: unknown = await backend.publish(loc, huge, META).catch((error: unknown) => error);
        expect(failure).toMatchObject({ code: "BAD_INPUT" });
    });

    test("anchor links go to the blob at the head, with a line range", () => {
        const { deps } = fakeGh();
        const pr = prInfo(deps, { host: "gh.dev", owner: "o", repo: "r", number: 7 }, ".");
        const ctx: LinkContext = { root: ".", head: HEAD, resolvePath: s => (s === "a.ts" ? "src/a.ts" : null), pr };
        const backend = createGithubBackend("github", deps);
        expect(backend.anchorLink({ path: "a.ts", start: 3, end: 5 }, ctx)).toBe(
            `https://gh.dev/o/r/blob/${HEAD}/src/a.ts#L3-L5`,
        );
        expect(backend.anchorLink({ path: "nope.ts", start: 1, end: 1 }, ctx)).toBeNull();
    });

    test("a comment from the old tool: pull asks for a new digest, and publish replaces it", async () => {
        const { deps, comments } = fakeGh();
        const backend = createGithubBackend("github", deps);
        const pr = prInfo(deps, { host: "gh.dev", owner: "o", repo: "r", number: 7 }, ".");
        const loc = { type: "github", pr } as const;
        const old = `<!-- diff-digest: {"v":1,"base":"${"a".repeat(40)}","head":"${HEAD}","branch":"x"} -->`;
        comments.push({
            id: 1,
            html_url: "https://gh.dev/o/r/pull/7#c1",
            body: `${old}\n# Old\n\n<sub>diff-digest · open locally: <code>x</code></sub>\n`,
        });
        const failure: unknown = await backend.pull(loc).catch((error: unknown) => error);
        expect(failure).toMatchObject({
            code: "BAD_INPUT",
            hint: "This digest was made by the old diff-digest. Run `diff-digest init` and `publish` to replace it.",
        });
        expect(String(failure)).not.toContain("✖");
        expect(await backend.publish(loc, BODY, META)).toMatchObject({ updated: true });
        expect(comments).toHaveLength(1);
        expect(comments[0]?.body).toContain('"id":"abcd1234"');
    });

    test("a comment that cannot be updated is posted again, with a warning", async () => {
        const { deps, comments } = fakeGh(true);
        const backend = createGithubBackend("github", deps);
        const loc = {
            type: "github",
            pr: prInfo(deps, { host: "gh.dev", owner: "o", repo: "r", number: 7 }, "."),
        } as const;
        comments.push({ id: 1, html_url: "https://gh.dev/o/r/pull/7#c1", body: "<!-- diff-digest: {} -->" });
        const published = await backend.publish(loc, BODY, META);
        expect(published).toMatchObject({ updated: false, ref: "https://gh.dev/o/r/pull/7#c2" });
        expect(published.warnings).toHaveLength(1);
        expect(comments).toHaveLength(2);
    });

    test("a comment line from gh that is not a comment is BACKEND_FAILED", async () => {
        const { deps } = fakeDeps(call => ok(call.args[1] === "--paginate" ? '{"id":"x"}' : JSON.stringify(PULL)));
        const backend = createGithubBackend("github", deps);
        const loc = {
            type: "github",
            pr: prInfo(deps, { host: "gh.dev", owner: "o", repo: "r", number: 7 }, "."),
        } as const;
        const failure: unknown = await backend.pull(loc).catch((error: unknown) => error);
        expect(failure).toMatchObject({ code: "BACKEND_FAILED" });
    });

    test("anchor links encode each path segment", () => {
        const { deps } = fakeGh();
        const pr = prInfo(deps, { host: "gh.dev", owner: "o", repo: "r", number: 7 }, ".");
        const ctx: LinkContext = { root: ".", head: HEAD, resolvePath: () => "src/a#b c.ts", pr };
        expect(createGithubBackend("github", deps).anchorLink({ path: "a.ts", start: 1, end: 1 }, ctx)).toBe(
            `https://gh.dev/o/r/blob/${HEAD}/src/a%23b%20c.ts#L1`,
        );
    });
});
