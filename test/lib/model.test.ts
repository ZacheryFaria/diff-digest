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
            "  a -- some re-try label --> b",
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

    test("a chain of edges with no labels keeps every node", () => {
        expect(parseDiagram("flowchart LR\n  a --- b --> c ==> d -.-> e <--> f\n", 1).nodes.map(n => n.id)).toEqual([
            "a",
            "b",
            "c",
            "d",
            "e",
            "f",
        ]);
    });
});

function ids(source: string): string[] {
    return parseDiagram(source, 1).nodes.map(n => n.id);
}

describe("parseDiagram: more Mermaid syntax", () => {
    test("o and x arrow ends and ~~~ are edges, not nodes", () => {
        expect(ids("flowchart LR\n  a --o b\n  b --x c\n  c o--o d\n  d x--x e\n  e ~~~ f\n")).toEqual([
            "a",
            "b",
            "c",
            "d",
            "e",
            "f",
        ]);
    });

    test("a & b names both nodes", () => {
        expect(ids("flowchart LR\n  a --> b & c\n  d & e --> f\n")).toEqual(["a", "b", "c", "d", "e", "f"]);
    });

    test("a ; or a ] inside a quoted label does not end the statement", () => {
        const d = parseDiagram('flowchart LR\n  a["① x; y"]:::changed --> b["list[0] & more"]\n', 1);
        expect(d.nodes.map(n => [n.id, n.label, n.changed])).toEqual([
            ["a", "① x; y", true],
            ["b", "list[0] & more", false],
        ]);
    });

    test("accTitle, accDescr, and linkStyle lines are skipped", () => {
        const source = [
            "flowchart LR",
            "  accTitle: The title",
            "  accDescr: One line",
            "  accDescr {",
            "    more text",
            "  }",
            "  linkStyle 0 stroke:#f00",
            "  a --> b",
        ].join("\n");
        expect(ids(source)).toEqual(["a", "b"]);
    });

    test("only flowchart and graph diagrams have nodes", () => {
        expect(ids("sequenceDiagram\n  Alice->>Bob: hi\n")).toEqual([]);
        expect(ids("%% comment\ngraph TD\n  a --> b\n")).toEqual(["a", "b"]);
        expect(ids("---\ntitle: T\n---\nflowchart LR\n  a --> b\n")).toEqual(["a", "b"]);
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
            [1, 31],
            [2, 32],
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

    test("a nested item gets its own block id and line, in the same section", () => {
        const body = GOOD_BODY.replace("`src/view.tsx:3`\n", "`src/view.tsx:3`\n  - Nested note.\n");
        const nested = buildModel(body, 8).blocks.find(b => b.text === "Nested note.");
        expect(nested).toMatchObject({ section: "Changes", line: 33 });
        const parent = buildModel(body, 8).blocks.find(b => b.line === 32);
        expect(parent?.text).toBe("② The badge renders when `retried` is true: `src/view.tsx:3`");
    });
});
