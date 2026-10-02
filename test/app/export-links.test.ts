import { describe, expect, test } from "bun:test";
import { exportLinks } from "../../src/app/export-links";
import { DigestPayloadSchema } from "../../src/lib/schemas-api";

const SHA = "b".repeat(40);
const digest = DigestPayloadSchema.parse({
    id: "abcd1234",
    body: "\n# One\n",
    lineOffset: 9,
    frontmatter: { id: "abcd1234", branch: "b", base: "a".repeat(40), head: null, pinned: false, meta: {} },
    files: [{ status: "M", path: "src/a.ts", oldPath: "src/a.ts", cls: "source", untracked: false, marked: false }],
    head: SHA,
    stats: { files: 1, generated: 0, diffLines: 1, digestLines: 2 },
});

describe("exportLinks", () => {
    test("links a path suffix and its lines to the repo at the head commit", () => {
        const links = exportLinks({ digest, comments: [], repoUrl: "https://github.com/o/r" });
        expect(links.linkFor("a.ts", 3, 5)).toBe(`https://github.com/o/r/blob/${SHA}/src/a.ts#L3-L5`);
        expect(links.linkFor("src/a.ts")).toBe(`https://github.com/o/r/blob/${SHA}/src/a.ts`);
        expect(links.linkFor("b.ts", 1)).toBeNull();
    });

    test("gives no link with no repo URL or no head commit", () => {
        expect(exportLinks({ digest, comments: [], repoUrl: null }).linkFor("a.ts")).toBeNull();
        const noHead = { ...digest, head: null };
        expect(exportLinks({ digest: noHead, comments: [], repoUrl: "https://x/o/r" }).linkFor("a.ts")).toBeNull();
    });
});
