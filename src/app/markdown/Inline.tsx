// Rich inline Markdown. A code span that is an anchor (`path:10-14`) opens the code pane.
import { createElement, Fragment, type ReactNode } from "react";
import { useApp } from "../state/context";
import type { RichInline } from "./rich-inline";

const ANCHOR = /^([\w@#./-]+\.\w+)(?::(\d+)(?:-(\d+))?)?$/u;

function Anchor({ text }: { readonly text: string }): ReactNode {
    const { openCode, codePath, exported } = useApp();
    const match = ANCHOR.exec(text);
    if (match === null) return <code>{text}</code>;
    const [, path = text, startText = "", endText = ""] = match;
    const from = startText === "" ? undefined : Number(startText);
    const to = endText === "" ? from : Number(endText);
    if (exported !== null) {
        const href = exported.linkFor(path, from, to);
        return href === null ? (
            <code>{text}</code>
        ) : (
            <a className="anchor" href={href} target="_blank" rel="noreferrer">
                <code>{text}</code>
            </a>
        );
    }
    const open = (): void => {
        openCode({
            path,
            rev: "diff",
            ...(from === undefined ? {} : { start: from }),
            ...(to === undefined ? {} : { end: to }),
        });
    };
    return (
        <button type="button" className={codePath === path ? "anchor active" : "anchor"} onClick={open}>
            <code>{text}</code>
        </button>
    );
}

/** Children as separate `createElement` arguments need no keys (the order never changes). */
function wrap(type: string, props: Readonly<Record<string, string>> | null, nodes: readonly RichInline[]): ReactNode {
    return createElement(type, props, ...nodes.map(n => renderInline(n)));
}

export function renderInline(node: RichInline): ReactNode {
    if (node.kind === "text") return node.text;
    if (node.kind === "code") return createElement(Anchor, { text: node.text });
    if (node.kind === "strong" || node.kind === "em" || node.kind === "del")
        return wrap(node.kind, null, node.children);
    if (node.kind === "link") return wrap("a", { href: node.href, target: "_blank", rel: "noreferrer" }, node.children);
    if (node.kind === "image") return createElement("img", { src: node.href, alt: node.alt });
    if (node.kind === "br") return createElement("br");
    return createElement("code", { className: "raw-html" }, node.text);
}

export function Inline({ nodes }: { readonly nodes: readonly RichInline[] }): ReactNode {
    const parts: ReactNode[] = nodes.map(n => renderInline(n));
    return createElement(Fragment, null, ...parts);
}
