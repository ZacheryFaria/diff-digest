import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serializeDigest } from "../../src/lib/frontmatter";
import { rev } from "../../src/lib/repo";
import type { Frontmatter } from "../../src/lib/schemas";
import type { RegistryEntry } from "../../src/lib/schemas-api";
import type { TestRepo } from "./repo";

/** Writes a working copy for the repo's current HEAD (as base) and returns its registry entry. */
export function makeDigest(
    repo: TestRepo,
    home: string,
    body: string,
    overrides: Partial<Frontmatter> = {},
): RegistryEntry {
    const frontmatter: Frontmatter = {
        id: "abcd1234",
        branch: "main",
        base: rev(repo.root, "HEAD"),
        head: null,
        pinned: false,
        meta: {},
        ...overrides,
    };
    const mdPath = join(home, "store", "repo", "main.md");
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, serializeDigest(frontmatter, body));
    return { id: frontmatter.id, mdPath, root: repo.root, updatedAt: "2026-10-01T00:00:00.000Z" };
}
