import { z } from "zod";
import { DigestError } from "./errors";
import { FrontmatterSchema, type Frontmatter } from "./schemas";

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/u;

export interface ParsedDigest {
    readonly frontmatter: Frontmatter;
    readonly body: string;
}

/** Splits a digest into frontmatter and body, and validates the frontmatter. */
export function parseDigest(md: string): ParsedDigest {
    const match = FRONTMATTER.exec(md);
    const raw = match?.[1];
    if (match === null || raw === undefined) {
        throw new DigestError("BAD_INPUT", "The digest has no frontmatter.", {
            hint: "Create it with `diff-digest init`.",
        });
    }
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(raw);
    } catch (error) {
        throw new DigestError("BAD_INPUT", "The digest frontmatter is not valid YAML.", { cause: error });
    }
    const result = FrontmatterSchema.safeParse(parsed);
    if (!result.success) {
        throw new DigestError("BAD_INPUT", `The digest frontmatter is not valid:\n${z.prettifyError(result.error)}`);
    }
    return { frontmatter: result.data, body: md.slice(match[0].length) };
}

export function serializeDigest(frontmatter: Readonly<Frontmatter>, body: string): string {
    const yaml = Bun.YAML.stringify(FrontmatterSchema.parse(frontmatter), null, 2).trimEnd();
    return `---\n${yaml}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
}
