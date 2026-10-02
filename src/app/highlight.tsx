// Syntax highlighting for one code line, as React nodes (highlight.js core with a few languages).
import hljs from "highlight.js/lib/core";
import { createElement, Fragment, type ReactNode } from "react";
import { LANGUAGE_MODULES, languageFor } from "./languages";

for (const [name, language] of Object.entries(LANGUAGE_MODULES)) hljs.registerLanguage(name, language);

/** highlight.js output as a plain tree: text, or a span with a class and children. */
type Piece = string | { readonly className: string; readonly children: readonly Piece[] };

/** Walks the parsed highlight.js HTML into pieces (no DOM node is passed around). */
function piecesOf(html: string): Piece[] {
    const root = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstElementChild;
    if (root === null) return [];
    const top: Piece[] = [];
    const stack: { node: ChildNode; into: Piece[] }[] = [...root.childNodes]
        .map(node => ({ node, into: top }))
        .toReversed();
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
        if (item.node instanceof HTMLElement) {
            const children: Piece[] = [];
            item.into.push({ className: item.node.className, children });
            const kids = [...item.node.childNodes].map(node => ({ node, into: children }));
            stack.push(...kids.toReversed());
        } else {
            item.into.push(item.node.textContent ?? "");
        }
    }
    return top;
}

function render(piece: Piece): ReactNode {
    if (typeof piece === "string") return piece;
    // Children as separate arguments need no keys.
    return createElement("span", { className: piece.className }, ...piece.children.map(p => render(p)));
}

export function highlightLine(path: string, line: string): ReactNode {
    if (line === "") return " ";
    const language = languageFor(path);
    if (language === null || hljs.getLanguage(language) === undefined) return line;
    const pieces = piecesOf(hljs.highlight(line, { language, ignoreIllegals: true }).value);
    return createElement(Fragment, null, ...pieces.map(p => render(p)));
}
