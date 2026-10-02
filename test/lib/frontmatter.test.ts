import { describe, expect, test } from "bun:test";
import { parseDigest, serializeDigest } from "../../src/lib/frontmatter";
import { ShaSchema, type Frontmatter } from "../../src/lib/schemas";
import { expectDigestError } from "../helpers/repo";

const FM: Frontmatter = {
    id: "k3f9a0b2",
    branch: "zf/foo",
    base: ShaSchema.parse("a".repeat(40)),
    head: null,
    pinned: false,
    meta: { pr: "https://github.com/o/r/pull/1" },
};

describe("frontmatter", () => {
    test("round trips", () => {
        const md = serializeDigest(FM, "# Title\n");
        expect(md.startsWith("---\n")).toBe(true);
        expect(parseDigest(md)).toEqual({ frontmatter: FM, body: "\n# Title\n" });
    });

    test("writes an empty meta on one line, and reads it back", () => {
        const md = serializeDigest({ ...FM, meta: {} }, "# Title\n");
        expect(md).toContain("\nmeta: {}\n");
        expect(parseDigest(md).frontmatter.meta).toEqual({});
    });

    test("reads a digest with CRLF line ends", () => {
        const md = serializeDigest(FM, "# Title\n").replaceAll("\n", "\r\n");
        expect(parseDigest(md)).toEqual({ frontmatter: FM, body: "\n# Title\n" });
    });

    test("a digest with no frontmatter is BAD_INPUT", () => {
        expectDigestError(() => parseDigest("# Title\n"), "BAD_INPUT");
    });

    test("frontmatter with an unknown key is BAD_INPUT", () => {
        const md = serializeDigest(FM, "x").replace("pinned: false", "pinned: false\npr: x");
        expectDigestError(() => parseDigest(md), "BAD_INPUT");
    });

    test("frontmatter with invalid YAML is BAD_INPUT", () => {
        expectDigestError(() => parseDigest("---\nid: [unclosed\n---\n"), "BAD_INPUT");
    });
});
