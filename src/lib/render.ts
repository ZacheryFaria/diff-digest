// Anchor links for published digests (spec §5.3). Pure: the UI imports this file.
import { ANCHOR, type Anchor } from "./digest";
import { parseBlocks } from "./md";

/** The URL for an anchor, or null to leave the anchor as a plain code span. */
export type AnchorLinker = (anchor: Anchor) => string | null;

const LINKED_ANCHOR = /\[(`[\w@#./-]+\.\w+:\d+(?:-\d+)?`)\]\([^)\s]+\)/gu;

function codeLines(body: string): Set<number> {
    const out = new Set<number>();
    for (const b of parseBlocks(body)) {
        if (b.kind !== "code") continue;
        const count = b.raw.replace(/\n+$/u, "").split("\n").length;
        for (let l = b.line; l < b.line + count; l += 1) out.add(l);
    }
    return out;
}

function mapLines(body: string, fix: (line: string) => string): string {
    const code = codeLines(body);
    return body
        .split("\n")
        .map((line, i) => (code.has(i + 1) ? line : fix(line)))
        .join("\n");
}

/** `[\`a.ts:3\`](url)` becomes `` `a.ts:3` ``. Other links and code blocks do not change. */
export function unrenderLinks(body: string): string {
    return mapLines(body, line => line.replaceAll(LINKED_ANCHOR, "$1"));
}

/** Each anchor code span becomes a link when `link` returns a URL. Already linked anchors are linked once. */
export function renderLinks(body: string, link: AnchorLinker): string {
    return mapLines(unrenderLinks(body), line =>
        line.replaceAll(ANCHOR, (match: string, path: string, start: string, end: string | undefined) => {
            const url = link({ path, start: Number(start), end: Number(end ?? start) });
            return url === null ? match : `[${match}](${url})`;
        }),
    );
}
