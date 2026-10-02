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
            return [
                {
                    kind: "link",
                    href: LinkSchema.safeParse(token).data?.href ?? "",
                    children: fromTokens(nested(token)),
                },
            ];
        }
        case "image": {
            const image = ImageSchema.safeParse(token).data;
            return image === undefined ? [] : [{ kind: "image", href: image.href, alt: image.text }];
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

/** The rich inline nodes of a Markdown text (a heading, a paragraph, a list item, or a table cell). */
export function richInline(text: string): RichInline[] {
    const tokens: readonly unknown[] = marked.Lexer.lexInline(text, { gfm: true });
    return fromTokens(tokens);
}
