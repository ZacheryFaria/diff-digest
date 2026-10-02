// Opens a registered digest and builds what the server and the CLI return for it.
import { readFileSync } from "node:fs";
import { exactPattern, generatedMatcher, readConfigFile, resolveConfig } from "./config";
import { changedFiles, diffLineCount, isReviewable } from "./diff";
import { parseDigest } from "./frontmatter";
import { configPath } from "./paths";
import { repoKeys, tryRev, type RepoContext } from "./repo";
import type { ChangedFile, Frontmatter } from "./schemas";
import type { DigestPayload, RegistryEntry } from "./schemas-api";

export interface OpenDigest {
    readonly entry: RegistryEntry;
    readonly md: string;
    readonly frontmatter: Frontmatter;
    readonly body: string;
    readonly ctx: RepoContext;
    readonly files: readonly ChangedFile[];
    /** The patterns in this repo's config entry ("Mark generated" writes here). */
    readonly repoGenerated: readonly string[];
}

/** Reads the digest file, its frontmatter, the repo context, and the changed files. */
export function openDigest(entry: RegistryEntry, home?: string): OpenDigest {
    const md = readFileSync(entry.mdPath, "utf8");
    const { frontmatter, body } = parseDigest(md);
    const head = frontmatter.pinned && frontmatter.head !== null ? frontmatter.head : "worktree";
    const ctx: RepoContext = { root: entry.root, base: frontmatter.base, head };
    const config = resolveConfig(readConfigFile(configPath(home)), repoKeys(entry.root));
    const files = changedFiles(ctx, generatedMatcher(config));
    return { entry, md, frontmatter, body, ctx, files, repoGenerated: config.repoGenerated };
}

export function digestPayload(open: OpenDigest): DigestPayload {
    const marked = new Set(open.repoGenerated);
    const files = open.files.map(f => ({ ...f, marked: marked.has(exactPattern(f.path)) }));
    return {
        id: open.frontmatter.id,
        body: open.body,
        lineOffset: open.md.slice(0, open.md.length - open.body.length).split("\n").length - 1,
        frontmatter: open.frontmatter,
        files,
        head: open.ctx.head === "worktree" ? tryRev(open.ctx.root, "HEAD") : open.ctx.head,
        stats: {
            files: files.length,
            generated: files.filter(f => !isReviewable(f)).length,
            diffLines: diffLineCount(open.ctx, open.files),
            digestLines: open.body.split("\n").filter(l => l.trim() !== "").length,
        },
    };
}
