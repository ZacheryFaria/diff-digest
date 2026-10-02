// A Mermaid diagram. mermaid is a separate chunk, loaded only when a digest has a diagram.
import { useEffect, useRef, useState, type ReactNode } from "react";

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

export function Mermaid({ source }: { readonly source: string }): ReactNode {
    const box = useRef<HTMLDivElement>(null);
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
        };
        draw().catch(() => {
            if (live) setFailed(true);
        });
        return () => {
            live = false;
        };
    }, [source]);
    return failed ? <pre className="mermaid-error">{source}</pre> : <div className="mermaid" ref={box} />;
}
