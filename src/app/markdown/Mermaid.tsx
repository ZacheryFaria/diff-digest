// A Mermaid diagram. mermaid is a separate chunk, loaded only when a digest has a diagram.
import { useEffect, useRef, useState, type ReactNode } from "react";

let counter = 0;

export function Mermaid({ source }: { readonly source: string }): ReactNode {
    const box = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        counter += 1;
        const id = `mermaid-${counter}`;
        const draw = async (): Promise<void> => {
            const { default: mermaid } = await import("mermaid");
            mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
            const { svg } = await mermaid.render(id, source);
            const element = box.current;
            if (!live || element === null) return;
            // The one DOM change outside React: the SVG inside this element only.
            element.replaceChildren(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement);
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
