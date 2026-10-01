import { describe, expect, test } from "bun:test";
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

    test("the rendered body has no HTML", () => {
        expect(renderLinks(GOOD_BODY, LINK)).not.toMatch(/<[a-z!/]/u);
    });
});
