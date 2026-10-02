// The architecture-diagram focus: a click on a numbered node marks its note and its Changes bullets in the
// digest; a second click on it, or Escape, clears the mark.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DigestModel } from "../../lib/model";
import { diagramInfo, linesOf, nodeWithNumber, type DiagramView } from "../diagram-info";

export interface DiagramFocus {
    readonly diagram: DiagramView | null;
    readonly marked: (fileLine: number) => "first" | "on" | null;
    readonly focus: number | null;
}

export function useDiagramFocus(model: DigestModel): DiagramFocus {
    const info = useMemo(() => diagramInfo(model), [model]);
    const [focus, setFocus] = useState<number | null>(null);
    const pick = useCallback((n: number) => {
        setFocus(old => (old === n ? null : n));
    }, []);
    useEffect(() => {
        const stop = new AbortController();
        document.addEventListener(
            "keydown",
            e => {
                if (e.key === "Escape") setFocus(null);
            },
            { signal: stop.signal },
        );
        return () => {
            stop.abort();
        };
    }, []);
    const node = focus === null ? undefined : nodeWithNumber([...info.values()], focus);
    // Scroll to the first Changes bullet: the note is next to the diagram already.
    const scrollLine = node?.changes[0]?.line ?? node?.note?.line ?? null;
    const ranges = useMemo(() => linesOf(node), [node]);
    const marked = useCallback(
        (line: number) =>
            ranges.some(([a, b]) => line >= a && line <= b) ? (line === scrollLine ? "first" : "on") : null,
        [ranges, scrollLine],
    );
    const line = model.diagram?.line;
    const diagram = useMemo(
        (): DiagramView | null =>
            line === undefined || info.size === 0 ? null : { line, nodeFor: id => info.get(id), focus, pick },
        [line, info, focus, pick],
    );
    return { diagram, marked, focus };
}
