import { describe, expect, test } from "bun:test";
import { buildModel, circled, leadingNumber, parseDiagram } from "../../src/lib/model";
import { GOOD_BODY } from "../fixtures/digest";

describe("circled numbers", () => {
    test("convert both ways", () => {
        expect(circled(1)).toBe("①");
        expect(circled(20)).toBe("⑳");
        expect(leadingNumber('"③ x')).toBe(3);
        expect(leadingNumber("x ①")).toBeNull();
    });
});

describe("parseDiagram", () => {
    test("reads node shapes, labels, edges, and :::changed", () => {
        const d = parseDiagram('flowchart LR\n  a["① A"]:::changed --> b[(Store)]\n  b --> c\n  class c changed\n', 10);
        expect(d.nodes.map(n => [n.id, n.label, n.number, n.changed, n.line])).toEqual([
            ["a", "① A", 1, true, 12],
            ["b", "Store", null, false, 12],
            ["c", "", null, true, 13],
        ]);
        expect(d.hasChangedClassDef).toBe(false);
    });

    test("edge labels, class lists, and comments do not make nodes", () => {
        const source = [
            "flowchart LR",
            "  %% a comment",
            "  a -- some label --> b",
            "  b -->|piped| c",
            "  c == thick text ==> d",
            "  d -. dotted .-> e",
            "  class a,e changed",
        ].join("\n");
        const d = parseDiagram(source, 1);
        expect(d.nodes.map(n => [n.id, n.changed])).toEqual([
            ["a", true],
            ["b", false],
            ["c", false],
            ["d", false],
            ["e", true],
        ]);
    });
});

describe("buildModel", () => {
    test("reads the title, sections, diagram, notes, and changes with file lines", () => {
        const m = buildModel(GOOD_BODY, 8);
        expect(m.title).toEqual({ text: "Retry failed API calls", line: 10 });
        expect(m.sections.map(s => s.title)).toEqual(["Architecture", "Changes", "Tests"]);
        expect(m.diagram?.nodes.map(n => n.number)).toEqual([1, null, 2]);
        expect(m.notes.map(n => n.number)).toEqual([1, 2]);
        expect(m.changes.map(c => [c.number, c.line])).toEqual([
            [1, 28],
            [2, 29],
        ]);
    });

    test("block ids are stable and depend on the section", () => {
        const a = buildModel(GOOD_BODY).blocks;
        const b = buildModel(GOOD_BODY).blocks;
        expect(a.map(x => x.cid)).toEqual(b.map(x => x.cid));
        const changes = a.filter(x => x.section === "Changes");
        expect(changes.length).toBe(3);
        expect(new Set(a.map(x => x.cid)).size).toBe(a.length);
    });
});
