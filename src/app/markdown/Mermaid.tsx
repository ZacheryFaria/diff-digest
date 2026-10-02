// A Mermaid diagram. mermaid is a separate chunk, loaded only when a digest has a diagram.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { nodeIdFromSvg, type DiagramView } from "../diagram-info";
import { NodeCard, type CardPlace } from "./NodeCard";
import type { RichInline } from "./rich-inline";

let counter = 0;

/** The page colors (styles.css), so that a diagram matches the page. */
const THEME_VARIABLES = {
    background: "#18191b",
    primaryColor: "#212225",
    primaryBorderColor: "#363a3f",
    primaryTextColor: "#edeef0",
    lineColor: "#868a92",
    fontFamily: "Inter, system-ui, sans-serif",
} as const;

/** The SVG node element under a pointer target, and its node id, or null. */
function nodeUnder(target: unknown): { readonly element: Element; readonly id: string } | null {
    const element = target instanceof Element ? target.closest("g.node") : null;
    const id = element === null ? null : nodeIdFromSvg(element.id);
    return element === null || id === null ? null : { element, id };
}

/** The element for the SVG. The picked node gets a class on its SVG group (inside this element only). */
function useDiagramBox(view: DiagramView | null, drawn: number): { readonly current: HTMLDivElement | null } {
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // Nothing to mark before the first draw; each new draw marks again.
        if (drawn === 0) return;
        for (const g of box.current?.querySelectorAll("g.node") ?? []) {
            const node = view?.nodeFor(nodeIdFromSvg(g.id) ?? "");
            g.classList.toggle("picked", node !== undefined && node.number !== null && node.number === view?.focus);
        }
    }, [view, drawn]);
    return box;
}

/** The hover card and the click for the nodes of the architecture diagram. */
function NodeLayer({
    view,
    inline,
    children,
}: {
    readonly view: DiagramView;
    readonly inline: (text: string) => readonly RichInline[];
    readonly children: () => ReactNode;
}): ReactNode {
    const wrap = useRef<HTMLDivElement>(null);
    const [card, setCard] = useState<CardPlace | null>(null);
    return (
        <div
            className="mermaid-wrap"
            ref={wrap}
            onMouseOver={e => {
                if (e.target instanceof Element && e.target.closest(".node-card") !== null) return;
                const hit = nodeUnder(e.target);
                const node = hit === null ? undefined : view.nodeFor(hit.id);
                const outer = wrap.current?.getBoundingClientRect();
                if (hit === null || node === undefined || outer === undefined) {
                    setCard(null);
                    return;
                }
                const r = hit.element.getBoundingClientRect();
                setCard({ node, left: r.left - outer.left + r.width / 2, top: r.bottom - outer.top + 6 });
            }}
            onMouseLeave={() => {
                setCard(null);
            }}
            onClick={e => {
                const hit = nodeUnder(e.target);
                const number = hit === null ? null : (view.nodeFor(hit.id)?.number ?? null);
                if (number !== null) view.pick(number);
            }}
        >
            {children()}
            {card === null ? null : <NodeCard place={card} inline={inline} />}
        </div>
    );
}

export interface MermaidProps {
    readonly source: string;
    /** The architecture diagram: nodes get a card and a click. Null for other diagrams. */
    readonly view: DiagramView | null;
    readonly inline: (text: string) => readonly RichInline[];
}

export function Mermaid({ source, view, inline }: MermaidProps): ReactNode {
    const [drawn, setDrawn] = useState(0);
    const box = useDiagramBox(view, drawn);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        counter += 1;
        const id = `mermaid-${counter}`;
        const draw = async (): Promise<void> => {
            const { default: mermaid } = await import("mermaid");
            mermaid.initialize({
                startOnLoad: false,
                theme: "dark",
                themeVariables: THEME_VARIABLES,
                securityLevel: "strict",
                // A syntax error throws (and shows the source), and mermaid draws no error graphic.
                suppressErrorRendering: true,
            });
            const { svg } = await mermaid.render(id, source);
            const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
            // A parse error gives a <parsererror> root (Firefox) or a <parsererror> in the root (Chrome).
            if (root.nodeName !== "svg" || root.querySelector("parsererror") !== null)
                throw new Error("mermaid gave no valid SVG");
            const element = box.current;
            if (!live || element === null) return;
            // The one DOM change outside React: the SVG inside this element only.
            element.replaceChildren(root);
            setDrawn(n => n + 1);
        };
        draw().catch(() => {
            if (live) setFailed(true);
        });
        return () => {
            live = false;
        };
    }, [source, box]);
    if (failed) return <pre className="mermaid-error">{source}</pre>;
    if (view === null) return <div className="mermaid" ref={box} />;
    return (
        <NodeLayer view={view} inline={inline}>
            {() => <div className="mermaid" ref={box} />}
        </NodeLayer>
    );
}
