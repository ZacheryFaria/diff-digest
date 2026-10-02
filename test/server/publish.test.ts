import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { createRouterClient } from "@orpc/server";
import { registerDigest, registryPath } from "../../src/lib/registry";
import { git } from "../../src/lib/repo";
import { createServerContext } from "../../src/server/context";
import { router } from "../../src/server/router";
import { fakeDeps } from "../helpers/backend";
import { makeDigest } from "../helpers/digest";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

describe("publish.digest with the github backend", () => {
    test("finds the branch's PR, posts one comment with blob links, and lists the backends", async () => {
        repo = makeRepo();
        home = tempDir("dd-home-");
        repo.write("a.ts", "1\n");
        const head = repo.commit("init");
        git(repo.root, ["remote", "add", "origin", "git@gh.dev:o/r.git"]);
        repo.write("a.ts", "2\n");
        registerDigest(makeDigest(repo, home, "\n# Two\n\n## Changes\n\n- two: `a.ts:1`\n"), registryPath(home));
        writeFileSync(`${home}/config.json`, "{}");
        const pull = {
            html_url: "https://gh.dev/o/r/pull/7",
            title: "T",
            state: "open",
            base: { ref: "main", sha: head },
            head: { ref: "main", sha: head },
        };
        const posted: string[] = [];
        const { deps } = fakeDeps(call => {
            const a = call.args;
            if (a[0] === "pr") return { ok: true, stdout: JSON.stringify([{ number: 7 }]), stderr: "" };
            if (a[1] === "repos/o/r/pulls/7") return { ok: true, stdout: JSON.stringify(pull), stderr: "" };
            if (a[1] === "--paginate") return { ok: true, stdout: "", stderr: "" };
            posted.push(call.input ?? "");
            return {
                ok: true,
                stdout: JSON.stringify({ id: 1, html_url: "https://gh.dev/o/r/pull/7#c1", body: "" }),
                stderr: "",
            };
        });
        const client = createRouterClient(router, { context: createServerContext(home, deps) });
        expect(await client.publish.backends({ id: "abcd1234" })).toEqual([{ name: "github", type: "github" }]);
        const report = await client.publish.digest({ id: "abcd1234", to: [], force: false, dryRun: false });
        expect(report).toMatchObject({
            results: [{ backend: "github", ref: "https://gh.dev/o/r/pull/7#c1", updated: false }],
            skipped: [],
        });
        expect(posted[0]).toContain(`https://gh.dev/o/r/blob/${head}/a.ts#L1`);
        expect(posted[0]).toContain("<!-- diff-digest: ");
    });
});
