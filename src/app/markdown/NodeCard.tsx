// The card for a diagram node: its note, and the Changes bullets with the same number (their anchors open code).
import type { ReactNode } from "react";
import type { NodeInfo } from "../diagram-info";
import { Inline } from "./Inline";
import type { RichInline } from "./rich-inline";

/** The card shows at most this many Changes bullets; a click on the node marks all of them. */
const MAX_CHANGES = 4;

export interface CardPlace {
    readonly node: NodeInfo;
    readonly left: number;
    readonly top: number;
}

export function NodeCard({
    place,
    inline,
}: {
    readonly place: CardPlace;
    readonly inline: (text: string) => readonly RichInline[];
}): ReactNode {
    const { node } = place;
    const more = node.changes.length - MAX_CHANGES;
    return (
        <div className="node-card" style={{ left: place.left, top: place.top }}>
            <div className="node-card-title">{node.label}</div>
            {node.number === null ? (
                <p className="node-card-note">Not changed in this diff.</p>
            ) : (
                <>
                    <p className="node-card-note">
                        {node.note === null ? "No note for this number." : <Inline nodes={inline(node.note.text)} />}
                    </p>
                    {node.changes.length === 0 ? null : (
                        <ul>
                            {node.changes.slice(0, MAX_CHANGES).map(c => (
                                <li key={c.line}>
                                    <Inline nodes={inline(c.text)} />
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="node-card-hint">
                        {more > 0 ? `${more} more. ` : ""}Click the node to mark its text in the digest.
                    </p>
                </>
            )}
        </div>
    );
}
