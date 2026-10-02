import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { fmtDigest } from "../../src/cli/fmt-digest";
import { registerDigest, registryPath } from "../../src/lib/registry";
import type { RegistryEntry } from "../../src/lib/schemas-api";
import { readComments } from "../../src/lib/store";
import { makeDigest } from "../helpers/digest";
import { makeRepo, tempDir, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
let home: string | undefined;
afterEach(() => {
    repo?.remove();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

const OPTIONS = { check: false, questionsToNotes: true } as const;
const QUESTIONS = "\n## Questions\n\n- Why one?\n\n## Changes\n\n- a is one: `a.ts:1`\n";

function setup(body: string, register = true): RegistryEntry {
    repo = makeRepo();
    home = tempDir("dd-home-");
    repo.write("a.ts", "0\n");
    repo.commit("init");
    repo.write("a.ts", "1\n");
    const entry = makeDigest(repo, home, body);
    if (register) registerDigest(entry, registryPath(home));
    return entry;
}

describe("fmt --questions-to-notes", () => {
    test("a digest with no H1 title keeps its Questions section", async () => {
        const entry = setup(QUESTIONS);
        const result = await fmtDigest(entry, home ?? "", OPTIONS);
        expect(result.questions).toEqual([]);
        expect(readFileSync(entry.mdPath, "utf8")).toContain("## Questions");
        expect(readComments(entry.mdPath)).toEqual([]);
    });

    test("each question becomes an agent note on the title, with a `Q: ` prefix", async () => {
        const entry = setup(`\n# One${QUESTIONS}`);
        const result = await fmtDigest(entry, home ?? "", OPTIONS);
        expect(result.questions).toEqual(["Why one?"]);
        expect(readFileSync(entry.mdPath, "utf8")).not.toContain("## Questions");
        expect(readComments(entry.mdPath)).toMatchObject([{ author: "agent", status: "note", body: "Q: Why one?" }]);
    });

    test("the notes are written before the file: a failed note leaves the file as it was", async () => {
        const entry = setup(`\n# One${QUESTIONS}`, false);
        const before = readFileSync(entry.mdPath, "utf8");
        const failed = await fmtDigest(entry, home ?? "", OPTIONS).then(
            () => null,
            (error: unknown) => error,
        );
        expect(failed).toMatchObject({ code: "NOT_FOUND" });
        expect(readFileSync(entry.mdPath, "utf8")).toBe(before);
    });
});
