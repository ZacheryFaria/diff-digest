// Rich inline Markdown for the UI: marked's inline tokens, parsed with zod into typed nodes.
// (src/lib/md.ts flattens inline text for the linter; the UI needs bold, links, and images.)
import { marked } from "marked";
import { z } from "zod";

export type RichInline =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "strong"; readonly children: readonly RichInline[] }
    | { readonly kind: "em"; readonly children: readonly RichInline[] }
    | { readonly kind: "del"; readonly children: readonly RichInline[] }
    | { readonly kind: "code"; readonly text: string }
    | { readonly kind: "link"; readonly href: string; readonly children: readonly RichInline[] }
    | { readonly kind: "image"; readonly href: string; readonly alt: string }
    | { readonly kind: "br" }
    | { readonly kind: "html"; readonly text: string };

const TypeSchema = z.looseObject({ type: z.string() });
const TextSchema = z.looseObject({ text: z.string() });
const NestedSchema = z.looseObject({ tokens: z.array(z.unknown()).readonly().optional() });
const LinkSchema = z.looseObject({ href: z.string() });
const ImageSchema = z.looseObject({ href: z.string(), text: z.string() });
const LinkDefsSchema = z.record(z.string(), z.object({ href: z.string() }).readonly()).readonly();
/** The link reference definitions of a body (`[ref]: url`), by their normalized label. */
export type LinkDefs = z.infer<typeof LinkDefsSchema>;

const SAFE_LINK = /^(?:https?:|mailto:)/iu;
const SAFE_IMAGE = /^(?:https?:|data:image\/)/iu;

/** A link goes to the web, to a mail address, or to an anchor on the page. Other links show as text. */
function safeLink(href: string): boolean {
    return href.startsWith("#") || SAFE_LINK.test(href);
}

/** An image comes from the web or is inline data. A relative image has no file to load from this page. */
function safeImage(href: string): boolean {
    return SAFE_IMAGE.test(href);
}

function nested(token: unknown): readonly unknown[] {
    return NestedSchema.safeParse(token).data?.tokens ?? [];
}

function textOf(token: unknown): string {
    return TextSchema.safeParse(token).data?.text ?? "";
}

function one(token: unknown): RichInline[] {
    const type = TypeSchema.safeParse(token).data?.type ?? "";
    switch (type) {
        case "strong": {
            return [{ kind: "strong", children: fromTokens(nested(token)) }];
        }
        case "em": {
            return [{ kind: "em", children: fromTokens(nested(token)) }];
        }
        case "del": {
            return [{ kind: "del", children: fromTokens(nested(token)) }];
        }
        case "codespan": {
            return [{ kind: "code", text: textOf(token) }];
        }
        case "link": {
            const href = LinkSchema.safeParse(token).data?.href ?? "";
            const children = fromTokens(nested(token));
            return safeLink(href) ? [{ kind: "link", href, children }] : children;
        }
        case "image": {
            const image = ImageSchema.safeParse(token).data;
            if (image === undefined) return [];
            return safeImage(image.href)
                ? [{ kind: "image", href: image.href, alt: image.text }]
                : [{ kind: "text", text: image.text }];
        }
        case "br": {
            return [{ kind: "br" }];
        }
        case "html": {
            return [{ kind: "html", text: textOf(token) }];
        }
        default: {
            const inner = nested(token);
            return inner.length > 0 ? fromTokens(inner) : [{ kind: "text", text: textOf(token) }];
        }
    }
}

export function fromTokens(tokens: readonly unknown[]): RichInline[] {
    return tokens.flatMap(t => one(t));
}

export function linkDefs(body: string): LinkDefs {
    return LinkDefsSchema.safeParse(marked.lexer(body, { gfm: true }).links).data ?? {};
}

/**
 * The rich inline nodes of a Markdown text (a heading, a paragraph, a list item, or a table cell).
 * `links` are the body's reference definitions, so that `[text][ref]` renders as a link.
 */
export function richInline(text: string, links: LinkDefs = {}): RichInline[] {
    const lexer = new marked.Lexer({ gfm: true });
    // The lexer reads reference links from its own (new) token list.
    Object.assign(lexer.tokens.links, links);
    const tokens: readonly unknown[] = lexer.inlineTokens(text);
    return fromTokens(tokens);
}
