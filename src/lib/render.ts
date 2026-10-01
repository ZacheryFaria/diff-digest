// Anchor links for published digests (spec §5.3). Pure: the UI imports this file.
import { ANCHOR, type Anchor } from "./digest";
import { codeLines, parseBlocks } from "./md";

/** The URL for an anchor, or null to leave the anchor as a plain code span. */
export type AnchorLinker = (anchor: Anchor) => string | null;

/** A linked anchor: `[\`a.ts:3\`](url)` or `[\`a.ts:3\`](<url>)`. */
const LINKED_ANCHOR = /\[(`[\w@#./-]+\.\w+:\d+(?:-\d+)?`)\]\((?:<[^<>\n]*>|[^)\s]+)\)/gu;
/** Another link (inline or reference). An anchor in its label is not linked again. */
const OTHER_LINK = /\[(?:[^[\]\n]|\[[^[\]\n]*\])*\](?:\((?:<[^<>\n]*>|[^)\n]*)\)|\[[^[\]\n]*\])/gu;
/** A URL with one of these characters is written as `<url>`, so the link stays valid CommonMark. */
const NEEDS_BRACKETS = /[\s()<>]/u;

/** The link destination for a URL: `<url>` (with `<` and `>` encoded) when it has a space or a parenthesis. */
function destination(url: string): string {
    if (!NEEDS_BRACKETS.test(url)) return url;
    return `<${url.replaceAll("<", "%3C").replaceAll(">", "%3E")}>`;
}

/** The [start, end) ranges of other links in the line. */
function linkRanges(line: string): (readonly [number, number])[] {
    const out: (readonly [number, number])[] = [];
    for (const m of line.matchAll(OTHER_LINK)) out.push([m.index, m.index + m[0].length]);
    return out;
}

function mapLines(body: string, fix: (line: string) => string): string {
    const code = codeLines(parseBlocks(body));
    return body
        .split("\n")
        .map((line, i) => (code.has(i + 1) ? line : fix(line)))
        .join("\n");
}

/** `[\`a.ts:3\`](url)` becomes `` `a.ts:3` ``. Other links and code blocks do not change. */
export function unrenderLinks(body: string): string {
    return mapLines(body, line => line.replaceAll(LINKED_ANCHOR, "$1"));
}

/**
 * Each anchor code span becomes a link when `link` returns a URL. Already linked anchors are linked once.
 * An anchor in the label of another link does not change.
 */
export function renderLinks(body: string, link: AnchorLinker): string {
    return mapLines(unrenderLinks(body), line => {
        const ranges = linkRanges(line);
        return line.replaceAll(
            ANCHOR,
            (match: string, path: string, start: string, end: string | undefined, at: number) => {
                if (ranges.some(([from, to]) => at >= from && at < to)) return match;
                const url = link({ path, start: Number(start), end: Number(end ?? start) });
                return url === null ? match : `[${match}](${destination(url)})`;
            },
        );
    });
}
