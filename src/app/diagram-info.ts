// What each architecture-diagram node means: its number, its note below the diagram, and the Changes bullets
// with the same number. Pure: the diagram card, the digest view, and the tests use it.
import type { DigestModel, NumberedItem } from "../lib/model";

export interface NodeInfo {
    readonly id: string;
    readonly label: string;
    readonly number: number | null;
    readonly note: NumberedItem | null;
    readonly changes: readonly NumberedItem[];
}

/** Node id → what the node means. Empty when the digest has no architecture diagram. */
export function diagramInfo(model: DigestModel): ReadonlyMap<string, NodeInfo> {
    const nodes = model.diagram?.nodes ?? [];
    return new Map(
        nodes.map(n => {
            const note = n.number === null ? undefined : model.notes.find(i => i.number === n.number);
            const changes = n.number === null ? [] : model.changes.filter(i => i.number === n.number);
            return [n.id, { id: n.id, label: n.label, number: n.number, note: note ?? null, changes }];
        }),
    );
}

/** The node id in a Mermaid SVG element id (`<render id>-flowchart-<node id>-<n>`), or null. */
export function nodeIdFromSvg(elementId: string): string | null {
    return /-flowchart-(.+)-\d+$/u.exec(elementId)?.[1] ?? null;
}

/** The node with a number, or undefined. */
export function nodeWithNumber(nodes: readonly NodeInfo[], number: number): NodeInfo | undefined {
    return nodes.find(n => n.number === number);
}

/** The file lines of a node's note and Changes bullets: the blocks to mark after a click. */
export function linesOf(node: NodeInfo | undefined): readonly (readonly [number, number])[] {
    if (node === undefined) return [];
    return [...(node.note === null ? [] : [node.note]), ...node.changes].map(i => [i.line, i.endLine] as const);
}

/** What the architecture diagram needs from the digest view. */
export interface DiagramView {
    /** The file line of the diagram's code block. */
    readonly line: number;
    readonly nodeFor: (id: string) => NodeInfo | undefined;
    /** The number that is marked in the digest, or null. */
    readonly focus: number | null;
    /** A click on a numbered node: mark its text, or clear the mark when it is marked. */
    readonly pick: (number: number) => void;
}
