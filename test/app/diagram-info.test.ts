import { describe, expect, test } from "bun:test";
import { diagramInfo, linesOf, nodeIdFromSvg, nodeWithNumber } from "../../src/app/diagram-info";
import { buildModel } from "../../src/lib/model";

const BODY = [
    "",
    "# One",
    "",
    "## Architecture",
    "",
    "```mermaid",
    "flowchart LR",
    '  api["① API client"]:::changed --> store[(Store)]',
    "  classDef changed stroke:#ffc430",
    "```",
    "",
    "1. ① Retries 3 times.",
    "",
    "## Changes",
    "",
    "- ① `get` retries: `a.ts:1`",
    "- Other change: `b.ts:2`",
    "- ① `put` retries too: `a.ts:5`",
    "",
].join("\n");

describe("diagramInfo", () => {
    test("links a numbered node to its note and its Changes bullets", () => {
        const info = diagramInfo(buildModel(BODY, 10));
        expect(info.get("api")).toMatchObject({
            number: 1,
            note: { text: "① Retries 3 times.", line: 22 },
            changes: [{ line: 26 }, { line: 28 }],
        });
        expect(info.get("store")).toMatchObject({ number: null, note: null, changes: [] });
        expect(linesOf(nodeWithNumber([...info.values()], 1))).toEqual([
            [22, 22],
            [26, 26],
            [28, 28],
        ]);
        expect(linesOf(nodeWithNumber([...info.values()], 9))).toEqual([]);
    });

    test("is empty with no diagram", () => {
        expect(diagramInfo(buildModel("\n# One\n")).size).toBe(0);
    });
});

describe("nodeIdFromSvg", () => {
    test("reads the node id from a Mermaid element id, also with a dash in it", () => {
        expect(nodeIdFromSvg("mermaid-1-flowchart-api-0")).toBe("api");
        expect(nodeIdFromSvg("mermaid-12-flowchart-my-node-15")).toBe("my-node");
        expect(nodeIdFromSvg("mermaid-1")).toBeNull();
    });
});
