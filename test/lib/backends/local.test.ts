import { describe, expect, test } from "bun:test";
import { unwrapFrontmatter, unwrapMarker, wrapFrontmatter, wrapMarker } from "../../../src/lib/backends/envelope";
import { createLocalBackend } from "../../../src/lib/backends/local";
import type { DigestMeta, LinkContext } from "../../../src/lib/backends/types";
import { renderLinks } from "../../../src/lib/render";
import { ShaSchema } from "../../../src/lib/schemas";
import { fakeDeps } from "../../helpers/backend";
import { expectDigestError } from "../../helpers/repo";

const META: DigestMeta = { v: 1, id: "abcd1234", branch: "zf/x", base: ShaSchema.parse("a".repeat(40)), head: null };
const BODY = "\n# Title\n\n- see `a.ts:3`\n";
const FOOTER = "diff-digest · open locally: `/diff-digest u`";
const CTX: LinkContext = { root: "/r", head: "b".repeat(40), resolvePath: s => `src/${s}`, pr: null };
const INPUT = { root: "/r", repo: "lca", name: "zf-x", branch: "zf/x", pr: null };

describe("envelopes", () => {
    test("marker and frontmatter envelopes round trip and keep the body", () => {
        expect(unwrapMarker(wrapMarker(BODY, META, FOOTER), "c")).toEqual({ body: BODY, meta: META });
        expect(unwrapFrontmatter(wrapFrontmatter(BODY, META, { tags: ["t"] }), "f")).toEqual({
            body: BODY,
            meta: META,
        });
        expectDigestError(() => unwrapMarker("no marker", "c"), "BAD_INPUT");
        expectDigestError(() => unwrapMarker('<!-- diff-digest: {"v":2} -->\nx', "c"), "BAD_INPUT");
    });

    test("a branch with --> or < in it cannot close the marker comment", () => {
        const meta = { ...META, branch: "a-->b<c" };
        const text = wrapMarker(BODY, meta, FOOTER);
        const line = text.split("\n")[0] ?? "";
        expect(line.indexOf("-->")).toBe(line.length - 3);
        expect(line).not.toContain("<c");
        expect(unwrapMarker(text, "c")).toEqual({ body: BODY, meta });
    });
});

describe("local backend", () => {
    test("publishes, updates, pulls, and writes the review next to the digest", async () => {
        const { deps, files } = fakeDeps();
        const config = {
            type: "local",
            dir: "/vault/{repo}/{branch}",
            frontmatter: { tags: ["diff-digest", "{repo}"] },
        } as const;
        const backend = createLocalBackend("notes", config, deps);
        const loc = await backend.locate(INPUT);
        if (loc === null) throw new Error("no location");
        expect(loc).toEqual({
            type: "local",
            digestPath: "/vault/lca/zf-x/zf-x.md",
            reviewPath: "/vault/lca/zf-x/zf-x.review.md",
            repo: "lca",
        });
        expect(await backend.publish(loc, BODY, META)).toMatchObject({ updated: false });
        expect(await backend.publish(loc, BODY, META)).toMatchObject({ ref: "/vault/lca/zf-x/zf-x.md", updated: true });
        expect(files.get("/vault/lca/zf-x/zf-x.md")).toContain("- lca");
        expect(await backend.pull(loc)).toEqual({ body: BODY, meta: META, ref: "/vault/lca/zf-x/zf-x.md" });
        await backend.publishReview(loc, "### Comments\n", "h");
        expect(files.get("/vault/lca/zf-x/zf-x.review.md")).toBe("### Comments\n");
    });

    test("links use the template, and none gives plain anchors", () => {
        const { deps } = fakeDeps();
        const linked = createLocalBackend(
            "n",
            { type: "local", dir: "/d", linkTemplate: "vscode://file/{root}/{path}:{start}" },
            deps,
        );
        expect(linked.anchorLink({ path: "a.ts", start: 3, end: 3 }, CTX)).toBe("vscode://file//r/src/a.ts:3");
        const plain = createLocalBackend("n", { type: "local", dir: "/d" }, deps);
        expect(plain.anchorLink({ path: "a.ts", start: 3, end: 3 }, CTX)).toBeNull();
        expect(renderLinks(BODY, a => linked.anchorLink(a, CTX))).toContain("[`a.ts:3`](vscode://file//r/src/a.ts:3)");
    });
});
