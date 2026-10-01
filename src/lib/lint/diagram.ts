import { circled } from "../model";
import type { LintIssue } from "../schemas";
import { issue, type LintRule } from "./rule";

export const MAX_DIAGRAM_NODES = 11;

export const nodeNumbers: LintRule = {
    id: "node-numbers",
    severity: "error",
    description:
        "The circled numbers are in sequence and the same in the diagram, the notes list, and the Changes bullets.",
    check: ({ model }) => {
        const diagram = model.diagram;
        const out: LintIssue[] = [];
        const numbers = new Set<number>();
        for (const node of diagram?.nodes ?? []) {
            if (node.number === null) continue;
            if (numbers.has(node.number))
                out.push(issue(nodeNumbers, node.line, `${circled(node.number)} is on more than one node.`));
            numbers.add(node.number);
        }
        for (let n = 1; n <= numbers.size; n += 1) {
            if (!numbers.has(n)) {
                out.push(
                    issue(
                        nodeNumbers,
                        diagram?.line ?? 1,
                        `The node numbers skip ${circled(n)}.`,
                        "Run `diff-digest fmt`.",
                    ),
                );
            }
        }
        for (const change of model.changes) {
            if (change.number !== null && !numbers.has(change.number)) {
                out.push(issue(nodeNumbers, change.line, `${circled(change.number)} is not a node in the diagram.`));
            }
        }
        return out;
    },
};

export const changedNodeMarked: LintRule = {
    id: "changed-node-marked",
    severity: "warn",
    description: "Each changed node has `:::changed` and a circled number.",
    check: ({ model }) => {
        const out: LintIssue[] = [];
        for (const node of model.diagram?.nodes ?? []) {
            if (node.changed && node.number === null) {
                out.push(
                    issue(changedNodeMarked, node.line, `Node "${node.id}" is changed but has no circled number.`),
                );
            }
            if (!node.changed && node.number !== null) {
                out.push(issue(changedNodeMarked, node.line, `Node "${node.id}" has a number but no \`:::changed\`.`));
            }
        }
        return out;
    },
};

export const diagramNotes: LintRule = {
    id: "diagram-notes",
    severity: "warn",
    description: "Each numbered node has a note below the diagram, so the digest makes sense without the picture.",
    check: ({ model }) => {
        const out: LintIssue[] = [];
        const notes = new Set(model.notes.map(n => n.number));
        const nodes = new Set((model.diagram?.nodes ?? []).map(n => n.number));
        for (const node of model.diagram?.nodes ?? []) {
            if (node.number !== null && !notes.has(node.number)) {
                out.push(issue(diagramNotes, node.line, `${circled(node.number)} has no note below the diagram.`));
            }
        }
        for (const note of model.notes) {
            if (note.number === null)
                out.push(issue(diagramNotes, note.line, "This note does not start with a circled number."));
            else if (!nodes.has(note.number))
                out.push(issue(diagramNotes, note.line, `${circled(note.number)} is not a node in the diagram.`));
        }
        return out;
    },
};

export const diagramSize: LintRule = {
    id: "diagram-size",
    severity: "warn",
    description: `The diagram has at most ${MAX_DIAGRAM_NODES} nodes.`,
    check: ({ model }) => {
        const d = model.diagram;
        if (d === null || d.nodes.length <= MAX_DIAGRAM_NODES) return [];
        return [
            issue(
                diagramSize,
                d.line,
                `The diagram has ${d.nodes.length} nodes.`,
                "Show modules and data flow, not functions.",
            ),
        ];
    },
};
