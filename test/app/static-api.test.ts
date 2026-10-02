import { describe, expect, test } from "bun:test";
import { staticApi } from "../../src/app/static-api";
import { DigestPayloadSchema } from "../../src/lib/schemas-api";

const DIGEST = DigestPayloadSchema.parse({
    id: "abcd1234",
    body: "\n# One\n",
    lineOffset: 9,
    frontmatter: { id: "abcd1234", branch: "b", base: "a".repeat(40), head: null, pinned: false, meta: {} },
    files: [],
    head: null,
    stats: { files: 0, generated: 0, diffLines: 0, digestLines: 2 },
});

describe("staticApi", () => {
    test("reads come from the payload, and writes throw READ_ONLY", async () => {
        const api = staticApi({ digest: DIGEST, comments: [], repoUrl: null });
        expect(await api.digest.get({ id: "abcd1234" })).toEqual(DIGEST);
        expect(await api.comments.list({ id: "abcd1234" })).toEqual([]);
        expect(await api.actions.status({ id: "abcd1234" })).toEqual({ listening: 0, queued: 0 });
        const failure: unknown = await api.actions.send({ id: "abcd1234", type: "apply" }).catch((e: unknown) => e);
        expect(failure).toMatchObject({ code: "READ_ONLY" });
    });
});
