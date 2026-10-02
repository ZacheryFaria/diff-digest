import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { exportHtml, webUrl } from "../../src/cli/export-html";
import { ExportOutputSchema } from "../../src/cli/outputs";
import { DigestPayloadSchema, StaticPayloadSchema } from "../../src/lib/schemas-api";
import { envelope, runCli } from "../helpers/cli";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

const DIGEST = DigestPayloadSchema.parse({
    id: "abcd1234",
    body: "\n# One `a` </script><b>\n",
    lineOffset: 9,
    frontmatter: { id: "abcd1234", branch: "b", base: "a".repeat(40), head: null, pinned: false, meta: {} },
    files: [],
    head: null,
    stats: { files: 0, generated: 0, diffLines: 0, digestLines: 2 },
});

function payloadOf(html: string): unknown {
    const json = /<script id="digest-payload" type="application\/json">(.*?)<\/script>/su.exec(html)?.[1] ?? "";
    return JSON.parse(json);
}

describe("export", () => {
    test("the payload and the script cannot end their elements early", () => {
        const html = exportHtml(
            { digest: DIGEST, comments: [], repoUrl: null },
            { js: 'const s = "</script>";', css: "a{}" },
        );
        expect(html).toContain("<title>One a &lt;/script&gt;&lt;b&gt;</title>");
        expect(html).toContain('const s = "<\\/script>";');
        expect(StaticPayloadSchema.parse(payloadOf(html)).digest.body).toBe(DIGEST.body);
    });

    test("webUrl is the origin's web page", () => {
        expect(webUrl({ host: "github.com", owner: "o", repo: "r" })).toBe("https://github.com/o/r");
        expect(webUrl(null)).toBeNull();
    });

    test("export writes one file that loads nothing from the network", () => {
        repo = makeRepo();
        home = tempDir("dd-home-");
        repo.write("a.ts", "1\n");
        repo.commit("init");
        runCli(["init"], repo.root, home);
        const out = join(home, "digest.html");
        const result = envelope(runCli(["export", "--out", out, "--json"], repo.root, home));
        expect(result.ok && ExportOutputSchema.parse(result.data).path).toBe(out);
        const html = readFileSync(out, "utf8");
        expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/u);
        expect(StaticPayloadSchema.parse(payloadOf(html)).comments).toEqual([]);
    }, 30_000);
});
