import { afterEach, describe, expect, test } from "bun:test";
import { readComments, updateComments } from "../../src/lib/store";
import { setupPublish, type PublishSetup } from "../helpers/publish";

let s: PublishSetup | undefined;
afterEach(() => s?.remove());

const NOTES = {
    backends: { github: { type: "github" }, notes: { type: "local", dir: "/vault" } },
    publishTo: ["github", "notes"],
};
const FAIL = { ok: false, stdout: "", stderr: "gh: connection refused" } as const;

describe("publish with more than one backend", () => {
    test("a failing gh does not stop the local backend, and the report has the error", async () => {
        s = setupPublish({ config: NOTES, gh: () => FAIL });
        const report = await s.client.publish.digest({ id: "abcd1234", to: [], force: false, dryRun: false });
        expect(report.results).toMatchObject([{ backend: "notes" }]);
        expect(report.errors).toMatchObject([{ backend: "github", code: "BACKEND_FAILED" }]);
        expect(s.files.get("/vault/main.md")).toContain("# Two");
    });

    test("when every backend fails, publish is BACKEND_FAILED with the errors", async () => {
        s = setupPublish({ gh: () => FAIL });
        const failure: unknown = await s.client.publish
            .digest({ id: "abcd1234", to: [], force: false, dryRun: false })
            .catch((error: unknown) => error);
        expect(failure).toMatchObject({
            code: "BACKEND_FAILED",
            data: { data: [{ backend: "github", code: "BACKEND_FAILED" }] },
        });
    });

    test("the branch's PR is found with --repo for the origin repo", async () => {
        s = setupPublish();
        await s.client.publish.digest({ id: "abcd1234", to: [], force: false, dryRun: false });
        const list = s.calls.find(c => c.args[0] === "pr");
        expect(list?.args).toContain("--repo");
        expect(list?.args[list.args.indexOf("--repo") + 1]).toBe("gh.dev/o/r");
    });

    test("a digest made from a PR publishes to that PR, not to the branch's PR", async () => {
        s = setupPublish({ frontmatter: { meta: { pr: "https://gh.dev/o/r/pull/9" } } });
        await s.client.publish.digest({ id: "abcd1234", to: [], force: false, dryRun: false });
        expect(s.calls.some(c => c.args[0] === "pr")).toBe(false);
        expect(s.calls.some(c => c.args.includes("repos/o/r/issues/9/comments"))).toBe(true);
    });

    test("a dry run shows each backend's envelope, and refuses a body over the github limit", async () => {
        s = setupPublish({ config: NOTES });
        const dry = await s.client.publish.digest({ id: "abcd1234", to: [], force: false, dryRun: true });
        expect(dry.previews[0]?.text).toStartWith("<!-- diff-digest: ");
        expect(dry.previews[0]?.text).toContain("diff-digest · open locally:");
        expect(dry.previews[1]?.text).toStartWith("---\n");
        expect(s.posted).toEqual([]);
        s.remove();
        s = setupPublish({ body: `\n# Two\n\n${"x".repeat(70_000)}\n` });
        const failure: unknown = await s.client.publish
            .digest({ id: "abcd1234", to: [], force: true, dryRun: true })
            .catch((error: unknown) => error);
        expect(failure).toMatchObject({ code: "BAD_INPUT" });
    });

    test("the github envelope has no HTML other than the marker", async () => {
        s = setupPublish();
        await s.client.publish.digest({ id: "abcd1234", to: [], force: false, dryRun: false });
        const posted: unknown = JSON.parse(s.posted[0] ?? "{}");
        const body = typeof posted === "object" && posted !== null && "body" in posted ? String(posted.body) : "";
        const [marker = "", ...rest] = body.split("\n");
        expect(marker).toMatch(/^<!-- diff-digest: \{.*\} -->$/u);
        expect(rest.join("\n")).not.toMatch(/<\/?[a-z!][^>]*>/iu);
    });
});

describe("comments --publish", () => {
    test("with no open user comments it is BAD_INPUT and posts nothing", async () => {
        s = setupPublish();
        const failure: unknown = await s.client.publish
            .review({ id: "abcd1234", to: [] })
            .catch((error: unknown) => error);
        expect(failure).toMatchObject({ code: "BAD_INPUT", message: "No open comments to post." });
        expect(s.posted).toEqual([]);
        updateComments(s.mdPath, () => [
            {
                id: "c1",
                created: "2026-10-01T00:00:00.000Z",
                author: "user",
                status: "resolved",
                target: { kind: "digest", cid: "b1", section: "", text: "Two" },
                body: "x",
            },
        ]);
        expect(await s.client.publish.review({ id: "abcd1234", to: [] }).catch(() => "failed")).toBe("failed");
        expect(readComments(s.mdPath)).toHaveLength(1);
    });
});
