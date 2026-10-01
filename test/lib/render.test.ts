import { describe, expect, test } from "bun:test";
import { parseBlocks } from "../../src/lib/md";
import { renderLinks, unrenderLinks, type AnchorLinker } from "../../src/lib/render";
import { GOOD_BODY } from "../fixtures/digest";

const LINK: AnchorLinker = a => `https://x.dev/blob/sha/${a.path}#L${a.start}-L${a.end}`;

describe("render", () => {
    test("links each anchor, and unrender gives the same body back", () => {
        const rendered = renderLinks(GOOD_BODY, LINK);
        expect(rendered).toContain("[`src/api.ts:10-14`](https://x.dev/blob/sha/src/api.ts#L10-L14)");
        expect(unrenderLinks(rendered)).toBe(GOOD_BODY);
    });

    test("renders an already rendered body to the same text", () => {
        const once = renderLinks(GOOD_BODY, LINK);
        expect(renderLinks(once, LINK)).toBe(once);
    });

    test("a null link keeps the code span, and code blocks do not change", () => {
        const body = "- `a.ts:1`\n\n```\n`b.ts:2`\n```\n";
        expect(renderLinks(body, () => null)).toBe(body);
        expect(renderLinks(body, LINK)).toBe("- [`a.ts:1`](https://x.dev/blob/sha/a.ts#L1-L1)\n\n```\n`b.ts:2`\n```\n");
    });

    test("a code block in a blockquote does not change", () => {
        const body = "> text\n>\n> ```\n> `b.ts:2`\n> ```\n";
        expect(renderLinks(body, LINK)).toBe(body);
    });

    test("a URL with spaces, parentheses, or angle brackets round-trips and is one link", () => {
        const linkers: AnchorLinker[] = [
            a => `vscode://file//Users/me/My Repo/${a.path}:${a.start}`,
            a => `https://x.dev/v/(v1)/${a.path}`,
            a => `https://x.dev/<b>/${a.path}`,
        ];
        const body = "See `x.ts:3` now.\n";
        for (const link of linkers) {
            const rendered = renderLinks(body, link);
            expect(unrenderLinks(rendered)).toBe(body);
            expect(renderLinks(rendered, link)).toBe(rendered);
            const [paragraph] = parseBlocks(rendered);
            const links = paragraph?.kind === "paragraph" ? paragraph.inline.filter(i => i.kind === "link") : [];
            expect(links.length).toBe(1);
            expect(links[0]?.text).toBe("`x.ts:3`");
        }
        expect(renderLinks(body, linkers[0] ?? LINK)).toBe(
            "See [`x.ts:3`](<vscode://file//Users/me/My Repo/x.ts:3>) now.\n",
        );
        expect(renderLinks(body, linkers[2] ?? LINK)).toBe("See [`x.ts:3`](<https://x.dev/%3Cb%3E/x.ts>) now.\n");
    });

    test("an anchor in the label of another link is not linked", () => {
        const body = "- [see `a.ts:1` here](https://y.dev) and `b.ts:2`\n";
        expect(renderLinks(body, LINK)).toBe(
            "- [see `a.ts:1` here](https://y.dev) and [`b.ts:2`](https://x.dev/blob/sha/b.ts#L2-L2)\n",
        );
    });

    test("the rendered body has no HTML", () => {
        expect(renderLinks(GOOD_BODY, LINK)).not.toMatch(/<[a-z!/]/u);
    });
});
