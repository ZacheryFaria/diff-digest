# Plan 2: Model, lint, fmt, and render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse a digest body into a typed `Digest` model, lint it with the 14 rules of spec §9, fix it safely with `fmt`, and convert anchors to links and back for publishing.

**Architecture:** `md.ts` is the only file that reads `marked` tokens. It parses each token with zod into typed blocks with 1-based line numbers (marked's `Token` type includes `Tokens.Generic`, which has an `any` index signature). `model.ts` builds the `Digest` model from the blocks. `lint/` holds one file per rule group, and each rule is `{ id, severity, description, check }`. `fmt.ts` is a chain of small pure `body → body` fixes. `render.ts` converts anchor code spans to links and back. `md.ts`, `model.ts`, and `render.ts` are pure, because the UI imports them; a new lint override enforces this.

**Tech Stack:** Bun 1.4.2, TypeScript 7.0.2, zod 4.6.5, marked 18.0.14, oxlint 1.86.0 + oxlint-tsgolint, Prettier 3.9.9, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md` (§9 format enforcement, §5.3 render, §10 block ids, §11 strictness). Read also the "Carry-forward" table at the end of `docs/superpowers/plans/2026-09-30-plan-1-foundation.md`.

This is plan 2 of 7. Plan 1 (toolchain + `src/lib` core) is done.

## Global Constraints

- Work on `main`. No feature branch.
- Exact versions, no ranges. New in this plan: `marked` 18.0.14 (a runtime dependency). Plan 1 versions stay: `zod` 4.6.5, `typescript` 7.0.2, `oxlint` 1.86.0, `oxlint-tsgolint` 7.0.2003, `prettier` 3.9.9, `@types/bun` 1.4.2.
- `bun run verify` (typecheck + oxlint + suppression check + Prettier check + tests) must pass before each commit.
- No suppression comments and no `suppressions.json` entries without explicit approval from the user (spec §11.3).
- Lint config: the only change in this plan is the new purity override in Task 1. Do not turn off or weaken any rule.
- No `as` type assertions, except `as const`. Parse unknown data with zod. No `any`. No non-null assertions (`!`).
- Every parameter is deeply readonly (`prefer-readonly-parameter-types`). Do not take a `Map`, `Set`, `RegExp`, or mutable array as a parameter; take a function, a `Readonly<Record<…>>`, or a `readonly T[]`.
- Name each zod schema `XSchema`, and its type `X`. Schemas use `.readonly()`.
- `src/lib/digest.ts`, `src/lib/schemas.ts`, `src/lib/md.ts`, `src/lib/model.ts`, and `src/lib/render.ts` are pure: no Node or Bun imports, no `Bun` or `process` globals. The UI (plan 6) imports them.
- Regular expressions use the `u` flag.
- No rule rejects valid Markdown (spec product rule 1). Only `frontmatter`, `anchor-resolves`, and `node-numbers` are errors.
- `fmt` never deletes content, except the Questions section when `questionsToNotes` is true, and then it returns the removed questions.
- Files have at most 300 lines (`max-lines`); functions have at most 50 lines in `src/` (`max-lines-per-function`).
- Commit messages: conventional commits with `minor`, `bugfix`, `major`, or `chore`. No co-author line.
- Do not edit `bin/`, `ui/`, or `scripts/install.mjs`.

## Notes for the implementer

- Every code block in this plan was run in a scratch copy of the repo and passes `bun run verify`. Copy each block exactly.
- oxlint prints nothing when there are no problems. Exit code 0 means pass.
- `ANCHOR` in `src/lib/digest.ts` has the `g` flag. Use it only with `matchAll` or `replaceAll`, which reset `lastIndex`. Never call `.test` or `.exec` on it (plan 1 carry-forward).
- Line numbers: `parseBlocks` gives lines in its input. `buildModel(body, lineOffset)` adds the number of frontmatter lines, so lint issues have file lines.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/md.ts` | marked tokens → typed `Block[]` with lines (pure) |
| `src/lib/model.ts` | `Block[]` → `DigestModel`: title, sections, diagram nodes, notes, changes, block ids (pure) |
| `src/lib/lint/rule.ts` | `LintRule`, `LintContext`, `LintInput`, shared helpers |
| `src/lib/lint/frontmatter.ts` | The `frontmatter` rule |
| `src/lib/lint/diagram.ts` | `node-numbers`, `changed-node-marked`, `diagram-notes`, `diagram-size` |
| `src/lib/lint/structure.ts` | `section-order`, `unknown-section`, `no-questions`, `KNOWN_SECTIONS` |
| `src/lib/lint/content.ts` | `anchor-resolves`, `no-intent`, `no-inline-html`, `no-wikilinks`, `link-style`, `table-max-columns` |
| `src/lib/lint/index.ts` | `RULES`, `lintDigest`, `hasErrors`, `formatRulesMarkdown` |
| `src/lib/fmt.ts` | Safe fixes and `formatDigest` |
| `src/lib/render.ts` | `renderLinks`, `unrenderLinks` (pure) |
| `src/lib/schemas.ts` | Add `LintSeveritySchema` and `LintIssueSchema` |
| `test/fixtures/digest.ts` | A digest body that passes every rule, and a valid frontmatter |

The spec §3 lists `lint.ts`. This plan uses a `lint/` folder, because one file would pass the 300-line limit. Task 1 updates the spec layout.

---

### Task 1: Markdown adapter and the purity lint rule

**Files:**
- Modify: `package.json`, `bun.lock` (add `marked`)
- Modify: `.oxlintrc.json` (add one override)
- Modify: `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md` (§3 lib file list)
- Create: `src/lib/md.ts`
- Test: `test/lib/md.test.ts`

**Interfaces:**
- Produces: `type Inline` (`text` | `code` | `link { href, raw }` | `html`), `interface ListItem { line; raw; text; inline }`, `interface Cell { text; inline }`, `type Block` (union on `kind`: `heading { depth, text, inline }`, `paragraph { text, inline }`, `list { ordered, items }`, `table { header, rows }`, `code { lang, text }`, `blockquote { text, inline }`, `html { text }`, `def`, `other { type }`; every block has `line` and `raw`), `inlineOf(tokens: readonly unknown[]) → Inline[]`, `parseBlocks(source) → Block[]`.

- [ ] **Step 1: Add marked**

Run: `bun add --exact marked@18.0.14`
Expected: `package.json` dependencies have `"marked": "18.0.14"`.

- [ ] **Step 2: Add the purity override to `.oxlintrc.json`**

Insert this object into `overrides`, directly after the `src/lib/**` override. It repeats the `src/lib` import groups, because an override replaces the settings of a rule and does not add to them.

```json
{
    "files": [
        "src/lib/digest.ts",
        "src/lib/schemas.ts",
        "src/lib/md.ts",
        "src/lib/model.ts",
        "src/lib/render.ts"
    ],
    "rules": {
        "no-restricted-imports": [
            "error",
            {
                "patterns": [
                    {
                        "group": [
                            "**/cli/**",
                            "**/server/**",
                            "**/app/**",
                            "react",
                            "react-dom"
                        ],
                        "message": "src/lib must not import other src folders or React."
                    },
                    {
                        "group": [
                            "node:*",
                            "bun",
                            "bun:*"
                        ],
                        "message": "The UI imports this file, so it must not import Node or Bun APIs."
                    }
                ]
            }
        ],
        "no-restricted-globals": [
            "error",
            {
                "name": "Bun",
                "message": "The UI imports this file, so it must not use Bun APIs."
            },
            {
                "name": "process",
                "message": "The UI imports this file, so it must not use Node APIs."
            }
        ]
    }
}
```

- [ ] **Step 3: Make sure that the purity rule works**

Run:

```bash
printf 'import { readFileSync } from "node:fs";\nexport const q = [readFileSync, process.pid, Bun.version];\n' > src/lib/render.ts && bunx oxlint src/lib/render.ts; rm src/lib/render.ts
```

Expected: three errors: `no-restricted-imports` for `node:fs`, and `no-restricted-globals` for `process` and `Bun`. (`render.ts` does not exist yet; Task 5 creates it.)

- [ ] **Step 4: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { parseBlocks } from "../../src/lib/md";

describe("parseBlocks", () => {
    test("gives each block its 1-based line", () => {
        const blocks = parseBlocks("# T\n\ntext\n\n- a\n- b\n");
        expect(blocks.map(b => [b.kind, b.line])).toEqual([
            ["heading", 1],
            ["paragraph", 3],
            ["list", 5],
        ]);
    });

    test("gives each list item its line and its inline code", () => {
        const [list] = parseBlocks("- a `x.ts:1`\n- **b**\n");
        if (list?.kind !== "list") throw new Error("expected a list");
        expect(list.items.map(i => [i.line, i.text])).toEqual([
            [1, "a `x.ts:1`"],
            [2, "**b**"],
        ]);
        expect(list.items[0]?.inline).toEqual([
            { kind: "text", text: "a " },
            { kind: "code", text: "x.ts:1" },
        ]);
        expect(list.items[1]?.inline).toEqual([{ kind: "text", text: "b" }]);
    });

    test("reads tables, code, HTML, links, and link definitions", () => {
        const md =
            "| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nx\n```\n\n<div>x</div>\n\n[r]: http://r\n\n<b>i</b> [l](http://y)\n";
        const blocks = parseBlocks(md);
        expect(blocks.map(b => b.kind)).toEqual(["table", "code", "html", "def", "paragraph"]);
        const [table, code, , , paragraph] = blocks;
        expect(table?.kind === "table" ? table.rows.map(r => r.map(c => c.text)) : null).toEqual([["1", "2"]]);
        expect(code?.kind === "code" ? [code.lang, code.text, code.line] : null).toEqual(["mermaid", "x", 5]);
        expect(paragraph?.kind === "paragraph" ? paragraph.inline.map(i => i.kind) : null).toEqual([
            "html",
            "text",
            "html",
            "text",
            "link",
        ]);
    });
});
```

- [ ] **Step 5: Run the test to make sure that it fails**

Run: `bun test test/lib/md.test.ts`
Expected: FAIL. The module `../../src/lib/md` is not found.

- [ ] **Step 6: Create `src/lib/md.ts`**

```ts
// The only file that reads marked tokens. marked's `Token` type includes `Tokens.Generic`, which
// has an `any` index signature, so every token is parsed with zod into the typed blocks below.
// Pure: the UI imports this file, so it must not import Node or Bun APIs.
import { marked } from "marked";
import { z } from "zod";

export type Inline =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "code"; readonly text: string }
    | { readonly kind: "link"; readonly text: string; readonly href: string; readonly raw: string }
    | { readonly kind: "html"; readonly text: string };

export interface ListItem {
    readonly line: number;
    readonly raw: string;
    /** The item text, without the bullet or the number. */
    readonly text: string;
    readonly inline: readonly Inline[];
}

export interface Cell {
    readonly text: string;
    readonly inline: readonly Inline[];
}

interface BlockBase {
    /** 1-based line of the first line of the block. */
    readonly line: number;
    readonly raw: string;
}

export type Block = BlockBase &
    (
        | {
              readonly kind: "heading";
              readonly depth: number;
              readonly text: string;
              readonly inline: readonly Inline[];
          }
        | { readonly kind: "paragraph"; readonly text: string; readonly inline: readonly Inline[] }
        | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly ListItem[] }
        | { readonly kind: "table"; readonly header: readonly Cell[]; readonly rows: readonly (readonly Cell[])[] }
        | { readonly kind: "code"; readonly lang: string; readonly text: string }
        | { readonly kind: "blockquote"; readonly text: string; readonly inline: readonly Inline[] }
        | { readonly kind: "html"; readonly text: string }
        | { readonly kind: "def" }
        | { readonly kind: "other"; readonly type: string }
    );

const Raw = z.looseObject({ type: z.string(), raw: z.string() });
const WithTokens = z.looseObject({ tokens: z.array(z.unknown()).optional() });
const TextToken = z.looseObject({ type: z.enum(["text", "escape", "strong", "em", "del"]), text: z.string() });
const CodespanToken = z.looseObject({ type: z.literal("codespan"), text: z.string() });
const LinkToken = z.looseObject({ type: z.literal("link"), text: z.string(), href: z.string(), raw: z.string() });
const HtmlToken = z.looseObject({ type: z.literal("html"), text: z.string() });
const HeadingToken = z.looseObject({ type: z.literal("heading"), depth: z.int(), text: z.string() });
const TextBlockToken = z.looseObject({ type: z.enum(["paragraph", "blockquote", "text"]), text: z.string() });
const ListItemToken = z.looseObject({ type: z.literal("list_item"), raw: z.string(), text: z.string() }).readonly();
const ListToken = z
    .looseObject({ type: z.literal("list"), ordered: z.boolean(), items: z.array(ListItemToken).readonly() })
    .readonly();
const CellToken = z.looseObject({ text: z.string(), tokens: z.array(z.unknown()).readonly() }).readonly();
const TableToken = z
    .looseObject({
        type: z.literal("table"),
        header: z.array(CellToken).readonly(),
        rows: z.array(z.array(CellToken).readonly()).readonly(),
    })
    .readonly();
const CodeToken = z.looseObject({ type: z.literal("code"), lang: z.string().optional(), text: z.string() });

function children(token: unknown): readonly unknown[] {
    const parsed = WithTokens.safeParse(token);
    return parsed.success ? (parsed.data.tokens ?? []) : [];
}

/** Flattens inline tokens. Text inside strong, em, and del becomes plain text. */
export function inlineOf(tokens: readonly unknown[]): Inline[] {
    const out: Inline[] = [];
    for (const token of tokens) {
        const code = CodespanToken.safeParse(token);
        if (code.success) {
            out.push({ kind: "code", text: code.data.text });
            continue;
        }
        const link = LinkToken.safeParse(token);
        if (link.success) {
            out.push({ kind: "link", text: link.data.text, href: link.data.href, raw: link.data.raw });
            continue;
        }
        const html = HtmlToken.safeParse(token);
        if (html.success) {
            out.push({ kind: "html", text: html.data.text });
            continue;
        }
        const nested = children(token);
        if (nested.length > 0) {
            out.push(...inlineOf(nested));
            continue;
        }
        const text = TextToken.safeParse(token);
        if (text.success) out.push({ kind: "text", text: text.data.text });
    }
    return out;
}

function lineAt(source: string, offset: number): number {
    return source.slice(0, offset).split("\n").length;
}

function listItems(source: string, offset: number, token: z.infer<typeof ListToken>): ListItem[] {
    const items: ListItem[] = [];
    let cursor = offset;
    for (const item of token.items) {
        const at = source.indexOf(item.raw, cursor);
        const start = at === -1 ? cursor : at;
        items.push({ line: lineAt(source, start), raw: item.raw, text: item.text, inline: inlineOf(children(item)) });
        cursor = start + item.raw.length;
    }
    return items;
}

function toCell(cell: z.infer<typeof CellToken>): Cell {
    return { text: cell.text, inline: inlineOf(cell.tokens) };
}

function toBlock(source: string, offset: number, token: unknown): Block | null {
    const base = Raw.safeParse(token);
    if (!base.success || base.data.type === "space") return null;
    const head = { line: lineAt(source, offset), raw: base.data.raw };
    const heading = HeadingToken.safeParse(token);
    if (heading.success) {
        const { depth, text } = heading.data;
        return { ...head, kind: "heading", depth, text, inline: inlineOf(children(token)) };
    }
    const textBlock = TextBlockToken.safeParse(token);
    if (textBlock.success) {
        const kind = textBlock.data.type === "blockquote" ? "blockquote" : "paragraph";
        const inline = inlineOf(children(token));
        return { ...head, kind, text: textBlock.data.text, inline };
    }
    const list = ListToken.safeParse(token);
    if (list.success) {
        return { ...head, kind: "list", ordered: list.data.ordered, items: listItems(source, offset, list.data) };
    }
    const table = TableToken.safeParse(token);
    if (table.success) {
        const header = table.data.header.map(c => toCell(c));
        return { ...head, kind: "table", header, rows: table.data.rows.map(r => r.map(c => toCell(c))) };
    }
    const code = CodeToken.safeParse(token);
    if (code.success) return { ...head, kind: "code", lang: code.data.lang ?? "", text: code.data.text };
    const html = HtmlToken.safeParse(token);
    if (html.success) return { ...head, kind: "html", text: html.data.text };
    if (base.data.type === "def") return { ...head, kind: "def" };
    return { ...head, kind: "other", type: base.data.type };
}

/** Parses Markdown (CommonMark + GFM) into typed blocks with 1-based line numbers. */
export function parseBlocks(source: string): Block[] {
    const tokens: readonly unknown[] = marked.lexer(source, { gfm: true });
    const blocks: Block[] = [];
    let offset = 0;
    for (const token of tokens) {
        const block = toBlock(source, offset, token);
        if (block !== null) blocks.push(block);
        const raw = Raw.safeParse(token);
        offset += raw.success ? raw.data.raw.length : 0;
    }
    return blocks;
}
```

- [ ] **Step 7: Run the test to make sure that it passes**

Run: `bun test test/lib/md.test.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 8: Update the spec layout**

In `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md` §3, replace the line

```
    lint.ts           rules on the model
```

with

```
    md.ts             marked tokens → typed blocks with lines (pure)
    lint/             rules on the model: rule.ts, frontmatter.ts, diagram.ts, structure.ts, content.ts, index.ts
```

- [ ] **Step 9: Run the full check**

Run: `bun run verify`
Expected: all steps pass. 48 tests.

- [ ] **Step 10: Commit**

```bash
git add package.json bun.lock .oxlintrc.json src/lib/md.ts test/lib/md.test.ts docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md
git commit -m "minor: add typed Markdown adapter and purity lint rule"
```

### Task 2: The Digest model

**Files:**
- Create: `src/lib/model.ts`
- Create: `test/fixtures/digest.ts`
- Test: `test/lib/model.test.ts`

**Interfaces:**
- Consumes: `parseBlocks`, `Block`, `Inline` (Task 1); `blockId` (`src/lib/digest.ts`).
- Produces: `circled(n) → string` (1 → ①, 20 → ⑳), `leadingNumber(text) → number | null`, `interface DiagramNode { id; label; number; changed; line }`, `interface Diagram { line; source; nodes; hasChangedClassDef }`, `interface NumberedItem { number; line; text }`, `interface Section { title; line; blocks }`, `interface ModelBlock { cid; section; text; line }`, `interface DigestModel { title; preamble; sections; diagram; notes; changes; blocks; all }`, `parseDiagram(source, line) → Diagram`, `buildModel(body, lineOffset = 0) → DigestModel`.
- Produces (`test/fixtures/digest.ts`): `GOOD_BODY` (passes every rule) and `FRONTMATTER` (a valid frontmatter block, 8 lines).

- [ ] **Step 1: Create the test fixture**

```ts
// A digest body that passes every lint rule. Tests change one part of it at a time.
export const GOOD_BODY = `
# Retry failed API calls

**Generated (not reviewed):** \`bun.lock\`

## Architecture

\`\`\`mermaid
flowchart LR
  api["① API client"]:::changed --> store[(Store)]
  store --> view["② List view"]:::changed
  classDef changed stroke:#ffc430,stroke-width:2px
\`\`\`

1. ① The client retries a failed call two times.
2. ② The list shows a retry badge.

## Changes

- ① \`fetchItems()\` is now \`fetchItems({ retries: 2 })\`: \`src/api.ts:10-14\`
- ② The badge renders when \`retried\` is true: \`src/view.tsx:3\`

## Tests

| Test | Proves | Why this case |
|---|---|---|
| retries twice | The third failure is final | Edge case |
`;

export const FRONTMATTER = `---
id: k3f9a0b2
branch: zf/retry
base: ${"a".repeat(40)}
head: null
pinned: false
meta: {}
---
`;
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { buildModel, circled, leadingNumber, parseDiagram } from "../../src/lib/model";
import { GOOD_BODY } from "../fixtures/digest";

describe("circled numbers", () => {
    test("convert both ways", () => {
        expect(circled(1)).toBe("①");
        expect(circled(20)).toBe("⑳");
        expect(leadingNumber('"③ x')).toBe(3);
        expect(leadingNumber("x ①")).toBeNull();
    });
});

describe("parseDiagram", () => {
    test("reads node shapes, labels, edges, and :::changed", () => {
        const d = parseDiagram('flowchart LR\n  a["① A"]:::changed --> b[(Store)]\n  b --> c\n  class c changed\n', 10);
        expect(d.nodes.map(n => [n.id, n.label, n.number, n.changed, n.line])).toEqual([
            ["a", "① A", 1, true, 12],
            ["b", "Store", null, false, 12],
            ["c", "", null, true, 13],
        ]);
        expect(d.hasChangedClassDef).toBe(false);
    });
});

describe("buildModel", () => {
    test("reads the title, sections, diagram, notes, and changes with file lines", () => {
        const m = buildModel(GOOD_BODY, 8);
        expect(m.title).toEqual({ text: "Retry failed API calls", line: 10 });
        expect(m.sections.map(s => s.title)).toEqual(["Architecture", "Changes", "Tests"]);
        expect(m.diagram?.nodes.map(n => n.number)).toEqual([1, null, 2]);
        expect(m.notes.map(n => n.number)).toEqual([1, 2]);
        expect(m.changes.map(c => [c.number, c.line])).toEqual([
            [1, 28],
            [2, 29],
        ]);
    });

    test("block ids are stable and depend on the section", () => {
        const a = buildModel(GOOD_BODY).blocks;
        const b = buildModel(GOOD_BODY).blocks;
        expect(a.map(x => x.cid)).toEqual(b.map(x => x.cid));
        const changes = a.filter(x => x.section === "Changes");
        expect(changes.length).toBe(3);
        expect(new Set(a.map(x => x.cid)).size).toBe(a.length);
    });
});
```

- [ ] **Step 3: Run the test to make sure that it fails**

Run: `bun test test/lib/model.test.ts`
Expected: FAIL. The module `../../src/lib/model` is not found.

- [ ] **Step 4: Create `src/lib/model.ts`**

```ts
// The typed Digest model: what the linter, fmt, and the UI read. Pure: no Node or Bun APIs.
import { blockId } from "./digest";
import { parseBlocks, type Block, type Inline } from "./md";

/** ① is 1 and ⑳ is 20. */
const CIRCLED_ONE = 0x24_60;
const CIRCLED_MAX = 20;

export function circled(n: number): string {
    return String.fromCodePoint(CIRCLED_ONE + n - 1);
}

/** The circled number at the start of the text (after spaces and quotes), or null. */
export function leadingNumber(text: string): number | null {
    const first = text.trimStart().replace(/^["']/u, "").codePointAt(0);
    if (first === undefined) return null;
    const n = first - CIRCLED_ONE + 1;
    return n >= 1 && n <= CIRCLED_MAX ? n : null;
}

export interface DiagramNode {
    readonly id: string;
    readonly label: string;
    readonly number: number | null;
    readonly changed: boolean;
    readonly line: number;
}

export interface Diagram {
    readonly line: number;
    readonly source: string;
    /** Each node once, in the order of its first appearance. */
    readonly nodes: readonly DiagramNode[];
    readonly hasChangedClassDef: boolean;
}

export interface NumberedItem {
    readonly number: number | null;
    readonly line: number;
    readonly text: string;
}

export interface Section {
    readonly title: string;
    readonly line: number;
    readonly blocks: readonly Block[];
}

export interface ModelBlock {
    readonly cid: string;
    /** The h2 or h3 title that the block is under, or "" before the first heading. */
    readonly section: string;
    readonly text: string;
    readonly line: number;
}

export interface DigestModel {
    readonly title: { readonly text: string; readonly line: number } | null;
    readonly preamble: readonly Block[];
    readonly sections: readonly Section[];
    readonly diagram: Diagram | null;
    readonly notes: readonly NumberedItem[];
    readonly changes: readonly NumberedItem[];
    readonly blocks: readonly ModelBlock[];
    /** Every block, in order, for rules that check all text. */
    readonly all: readonly Block[];
}

const KEYWORD = /^(?:flowchart|graph|subgraph|end|classDef|style|linkStyle|click|direction|%%)\b/u;
const NODE =
    /([A-Za-z_][\w-]*)\s*(\[\[|\[\(|\(\(|\(\[|\[\/|\[\\|\[|\(|\{\{|\{|>)\s*(.*?)\s*(\]\]|\)\]|\)\)|\]\)|\/\]|\\\]|\]|\)|\}\}|\})(?::::([\w-]+))?/gu;
const BARE = /^([A-Za-z_][\w-]*)(?::::([\w-]+))?/u;
const ARROW = /\s*(?:<?[-=.]{2,}>?|--[^-|]+-->|-\.[^.]*\.->)\s*(?:\|[^|]*\|\s*)?/u;
const CLASS_LINE = /^class\s+([\w,\s-]+?)\s+([\w-]+)\s*;?$/u;

interface NodeDraft {
    readonly id: string;
    readonly label: string;
    readonly changed: boolean;
    readonly line: number;
}

function unquote(label: string): string {
    return label.replace(/^"(.*)"$/u, "$1");
}

/** The nodes that one statement defines or names. */
function readStatement(statement: string, line: number): NodeDraft[] {
    const classLine = CLASS_LINE.exec(statement);
    if (classLine !== null) {
        const [, ids = "", cls] = classLine;
        if (cls !== "changed") return [];
        return ids.split(",").map(id => ({ id: id.trim(), label: "", changed: true, line }));
    }
    const out: NodeDraft[] = [];
    for (const segment of statement.split(ARROW)) {
        const defined = [...segment.matchAll(NODE)];
        for (const m of defined) {
            const [, id = "", , label = "", , cls] = m;
            out.push({ id, label: unquote(label), changed: cls === "changed", line });
        }
        const bare = defined.length === 0 ? BARE.exec(segment.trim()) : null;
        if (bare !== null) {
            const [, id = "", cls] = bare;
            out.push({ id, label: "", changed: cls === "changed", line });
        }
    }
    return out;
}

export function parseDiagram(source: string, line: number): Diagram {
    const nodes = new Map<string, NodeDraft>();
    const add = (draft: NodeDraft): void => {
        const old = nodes.get(draft.id);
        nodes.set(
            draft.id,
            old === undefined
                ? draft
                : { ...old, label: old.label === "" ? draft.label : old.label, changed: old.changed || draft.changed },
        );
    };
    let hasChangedClassDef = false;
    for (const [i, text] of source.split("\n").entries()) {
        const statement = text.trim();
        if (/^classDef\s+changed\b/u.test(statement)) hasChangedClassDef = true;
        if (statement === "" || KEYWORD.test(statement)) continue;
        // The first line of the code block is the fence, so the source starts one line later.
        for (const part of statement.split(";"))
            for (const draft of readStatement(part.trim(), line + 1 + i)) add(draft);
    }
    const list: DiagramNode[] = [];
    for (const n of nodes.values()) list.push({ ...n, number: leadingNumber(n.label) });
    return { line, source, nodes: list, hasChangedClassDef };
}

function textOf(inline: readonly Inline[]): string {
    return inline.map(i => (i.kind === "code" ? `\`${i.text}\`` : i.text)).join("");
}

function normalize(text: string): string {
    return text.replaceAll(/\s+/gu, " ").trim();
}

function shift(block: Block, offset: number): Block {
    if (block.kind !== "list") return { ...block, line: block.line + offset };
    return { ...block, line: block.line + offset, items: block.items.map(i => ({ ...i, line: i.line + offset })) };
}

function modelBlocks(all: readonly Block[]): ModelBlock[] {
    const out: ModelBlock[] = [];
    let section = "";
    const add = (text: string, line: number): void => {
        const t = normalize(text);
        out.push({ cid: blockId(section, t), section, text: t, line });
    };
    for (const block of all) {
        switch (block.kind) {
            case "heading": {
                if (block.depth === 2 || block.depth === 3) section = normalize(block.text);
                add(textOf(block.inline), block.line);
                break;
            }
            case "paragraph":
            case "blockquote": {
                add(textOf(block.inline), block.line);
                break;
            }
            case "list": {
                for (const item of block.items) add(textOf(item.inline), item.line);
                break;
            }
            case "table": {
                for (const [i, row] of block.rows.entries())
                    add(row.map(c => textOf(c.inline)).join(" | "), block.line + 2 + i);
                break;
            }
            case "code": {
                add(block.text, block.line);
                break;
            }
            case "html":
            case "def":
            case "other": {
                break;
            }
        }
    }
    return out;
}

function numbered(items: readonly { readonly line: number; readonly text: string }[]): NumberedItem[] {
    return items.map(i => ({ number: leadingNumber(i.text), line: i.line, text: i.text }));
}

function listItemsIn(blocks: readonly Block[]): { line: number; text: string }[] {
    const out: { line: number; text: string }[] = [];
    for (const b of blocks)
        if (b.kind === "list") for (const item of b.items) out.push({ line: item.line, text: item.text });
    return out;
}

/**
 * Builds the model from a digest body. `lineOffset` is the number of lines before the body
 * (the frontmatter), so that every line number is a line in the file.
 */
export function buildModel(body: string, lineOffset = 0): DigestModel {
    const all = parseBlocks(body).map(b => shift(b, lineOffset));
    const firstH2 = all.findIndex(b => b.kind === "heading" && b.depth === 2);
    const preamble = firstH2 === -1 ? all : all.slice(0, firstH2);
    const sections: Section[] = [];
    for (const [i, block] of all.entries()) {
        if (block.kind !== "heading" || block.depth !== 2) continue;
        const next = all.findIndex((b, j) => j > i && b.kind === "heading" && b.depth === 2);
        sections.push({
            title: normalize(block.text),
            line: block.line,
            blocks: all.slice(i + 1, next === -1 ? undefined : next),
        });
    }
    const h1 = all.find(b => b.kind === "heading" && b.depth === 1);
    const architecture = sections.find(s => s.title.toLowerCase() === "architecture");
    const diagramIndex = architecture?.blocks.findIndex(b => b.kind === "code" && b.lang === "mermaid") ?? -1;
    const diagramBlock = architecture?.blocks[diagramIndex];
    const diagram = diagramBlock?.kind === "code" ? parseDiagram(diagramBlock.text, diagramBlock.line) : null;
    const notesBlock = architecture?.blocks.slice(diagramIndex + 1).find(b => b.kind === "list");
    const changes = sections.find(s => s.title.toLowerCase() === "changes");
    return {
        title: h1?.kind === "heading" ? { text: normalize(h1.text), line: h1.line } : null,
        preamble,
        sections,
        diagram,
        notes: diagram === null || notesBlock?.kind !== "list" ? [] : numbered(notesBlock.items),
        changes: numbered(listItemsIn(changes?.blocks ?? [])),
        blocks: modelBlocks(all),
        all,
    };
}
```

- [ ] **Step 5: Run the test to make sure that it passes**

Run: `bun test test/lib/model.test.ts`
Expected: 4 pass, 0 fail.

- [ ] **Step 6: Run the full check**

Run: `bun run verify`
Expected: all steps pass. 52 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/model.ts test/fixtures/digest.ts test/lib/model.test.ts
git commit -m "minor: add the typed digest model"
```

### Task 3: Lint rules

**Files:**
- Modify: `src/lib/schemas.ts` (append the lint schemas)
- Create: `src/lib/lint/rule.ts`
- Create: `src/lib/lint/frontmatter.ts`
- Create: `src/lib/lint/diagram.ts`
- Create: `src/lib/lint/structure.ts`
- Create: `src/lib/lint/content.ts`
- Create: `src/lib/lint/index.ts`
- Test: `test/lib/lint.test.ts`

**Interfaces:**
- Consumes: `buildModel`, `circled`, `DigestModel` (Task 2); `Block`, `Inline` (Task 1); `anchors`, `Anchor` (`src/lib/digest.ts`); `parseDigest` (`src/lib/frontmatter.ts`); `DigestError` (`src/lib/errors.ts`); `GOOD_BODY`, `FRONTMATTER` (Task 2).
- Produces (`schemas.ts`): `LintSeveritySchema`/`LintSeverity` (`"error" | "warn"`), `LintIssueSchema`/`LintIssue { rule, severity, line, message, hint? }`.
- Produces (`lint/index.ts`): `RULES: readonly LintRule[]` (14 rules, in the spec §9 order), `lintDigest(md, ctx: LintContext) → LintIssue[]` (sorted by line), `hasErrors(issues) → boolean`, `formatRulesMarkdown() → string`, and re-exports `LintContext`, `LintRule`, `INTENT_PHRASES`, `MAX_TABLE_COLUMNS` (5), `MAX_DIAGRAM_NODES` (11), `KNOWN_SECTIONS` (`Architecture`, `Changes`, `Tests`).
- Produces (`lint/structure.ts`, used by Task 4): `KNOWN_SECTIONS`, `QUESTIONS` (regex `^questions?$`, case-insensitive).
- `LintContext.checkAnchor(anchor) → string | null`: the caller (plan 4) checks the file and the lines; `null` means the anchor is good. `lintDigest` never reads the disk.

- [ ] **Step 1: Append the lint schemas to `src/lib/schemas.ts`**

Add this at the end of the file:

```ts
// ---- lint ----

export const LintSeveritySchema = z.enum(["error", "warn"]);
export type LintSeverity = z.infer<typeof LintSeveritySchema>;

export const LintIssueSchema = z
    .strictObject({
        rule: z.string().min(1),
        severity: LintSeveritySchema,
        /** 1-based line in the digest file. */
        line: z.int().positive(),
        message: z.string().min(1),
        hint: z.string().optional(),
    })
    .readonly();
export type LintIssue = z.infer<typeof LintIssueSchema>;
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { formatRulesMarkdown, hasErrors, lintDigest, RULES, type LintContext } from "../../src/lib/lint";
import { FRONTMATTER, GOOD_BODY } from "../fixtures/digest";

const OK: LintContext = { checkAnchor: () => null };

function rules(body: string, ctx: LintContext = OK): string[] {
    return lintDigest(`${FRONTMATTER}${body}`, ctx).map(i => i.rule);
}

describe("lintDigest", () => {
    test("a good digest has no issues", () => {
        expect(lintDigest(`${FRONTMATTER}${GOOD_BODY}`, OK)).toEqual([]);
    });

    test("valid but unusual Markdown gives no errors", () => {
        const body = `${GOOD_BODY}\n## Notes\n\n> [!NOTE]\n> A callout.\n\n- [ ] task\n\n~~old~~ <https://x.dev>\n\n---\n\n<div>raw</div>\n`;
        const issues = lintDigest(`${FRONTMATTER}${body}`, OK);
        expect(hasErrors(issues)).toBe(false);
        expect(issues.length).toBeGreaterThan(0);
    });

    test("frontmatter: a missing or bad frontmatter is an error on line 1", () => {
        const [issue] = lintDigest(GOOD_BODY, OK);
        expect(issue).toMatchObject({ rule: "frontmatter", severity: "error", line: 1 });
    });

    test("anchor-resolves: a bad anchor is an error on its file line", () => {
        const ctx: LintContext = { checkAnchor: a => (a.path === "src/view.tsx" ? "No such file" : null) };
        expect(lintDigest(`${FRONTMATTER}${GOOD_BODY}`, ctx)).toEqual([
            { rule: "anchor-resolves", severity: "error", line: 29, message: "No such file" },
        ]);
    });

    test("node-numbers: a skipped number, a duplicate, and an unknown Changes number", () => {
        expect(rules(GOOD_BODY.replace("② List view", "③ List view").replace("2. ②", "2. ③"))).toContain(
            "node-numbers",
        );
        expect(rules(GOOD_BODY.replace("② List view", "① List view"))).toContain("node-numbers");
        expect(rules(GOOD_BODY.replace("- ② The badge", "- ⑤ The badge"))).toEqual(["node-numbers"]);
    });

    test("changed-node-marked: a number without :::changed, and :::changed without a number", () => {
        expect(rules(GOOD_BODY.replace('view["② List view"]:::changed', 'view["② List view"]'))).toEqual([
            "changed-node-marked",
        ]);
        expect(rules(GOOD_BODY.replace("store[(Store)]", "store[(Store)]:::changed"))).toEqual(["changed-node-marked"]);
    });

    test("diagram-notes: a numbered node with no note, and a note that is not a node", () => {
        expect(rules(GOOD_BODY.replace("2. ② The list shows a retry badge.\n", ""))).toEqual(["diagram-notes"]);
        // ④ is not a node, and ② now has no note: two issues.
        expect(rules(GOOD_BODY.replace("2. ② The list", "2. ④ The list"))).toEqual(["diagram-notes", "diagram-notes"]);
    });

    test("diagram-size: more than 11 nodes", () => {
        const edges = Array.from({ length: 12 }, (_, i) => `  n${i} --> n${i + 1}`).join("\n");
        expect(rules(GOOD_BODY.replace("  store --> view", `${edges}\n  store --> view`))).toEqual(["diagram-size"]);
    });

    test("section-order, unknown-section, and no-questions", () => {
        const swapped = GOOD_BODY.replace("## Changes", "## Tmp")
            .replace("## Tests", "## Changes")
            .replace("## Tmp", "## Tests");
        expect(rules(swapped)).toContain("section-order");
        expect(rules(`${GOOD_BODY}\n## Rollout\n\ntext\n`)).toEqual(["unknown-section"]);
        expect(rules(`${GOOD_BODY}\n## Questions\n\n- Q1: why?\n`)).toEqual(["no-questions"]);
    });

    test("no-intent, no-inline-html, no-wikilinks, link-style, table-max-columns", () => {
        expect(rules(`${GOOD_BODY}\nThis exists in order to help.\n`)).toEqual(["no-intent"]);
        expect(rules(`${GOOD_BODY}\nA <b>bold</b> word.\n`)).toEqual(["no-inline-html"]);
        expect(rules(`${GOOD_BODY}\nSee [[Note]].\n`)).toEqual(["no-wikilinks"]);
        expect(rules(`${GOOD_BODY}\nSee [docs][d].\n\n[d]: https://x.dev\n`)).toEqual(["link-style", "link-style"]);
        expect(
            rules(`${GOOD_BODY}\n| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |\n`),
        ).toEqual(["table-max-columns"]);
    });

    test("formatRulesMarkdown lists every rule once", () => {
        const md = formatRulesMarkdown();
        for (const rule of RULES) expect(md).toContain(`| \`${rule.id}\` | ${rule.severity} |`);
        expect(RULES.filter(r => r.severity === "error").map(r => r.id)).toEqual([
            "frontmatter",
            "anchor-resolves",
            "node-numbers",
        ]);
    });
});
```

- [ ] **Step 3: Run the test to make sure that it fails**

Run: `bun test test/lib/lint.test.ts`
Expected: FAIL. The module `../../src/lib/lint` is not found.

- [ ] **Step 4: Create the six files in `src/lib/lint/`**

`src/lib/lint/rule.ts`:

```ts
// Shared types and helpers for the lint rules.
import type { Anchor } from "../digest";
import type { Inline, Block } from "../md";
import type { DigestModel } from "../model";
import type { LintIssue, LintSeverity } from "../schemas";

export interface LintContext {
    /** null when the anchor resolves to a file and a line range that exists; else a message. */
    readonly checkAnchor: (anchor: Anchor) => string | null;
}

export interface LintInput {
    readonly model: DigestModel;
    readonly frontmatterError: string | null;
    readonly ctx: LintContext;
}

export interface LintRule {
    readonly id: string;
    readonly severity: LintSeverity;
    readonly description: string;
    readonly check: (input: LintInput) => LintIssue[];
}

export interface LineInline {
    readonly line: number;
    readonly inline: readonly Inline[];
}

export function inlineLines(all: readonly Block[]): LineInline[] {
    const out: LineInline[] = [];
    for (const b of all) {
        switch (b.kind) {
            case "heading":
            case "paragraph":
            case "blockquote": {
                out.push({ line: b.line, inline: b.inline });
                break;
            }
            case "list": {
                for (const item of b.items) out.push({ line: item.line, inline: item.inline });
                break;
            }
            case "table": {
                out.push({ line: b.line, inline: b.header.flatMap(c => c.inline) });
                for (const [i, row] of b.rows.entries())
                    out.push({ line: b.line + 2 + i, inline: row.flatMap(c => c.inline) });
                break;
            }
            case "code":
            case "html":
            case "def":
            case "other": {
                break;
            }
        }
    }
    return out;
}

export function issue(rule: LintRule, line: number, message: string, hint?: string): LintIssue {
    return { rule: rule.id, severity: rule.severity, line, message, ...(hint === undefined ? {} : { hint }) };
}
```

`src/lib/lint/frontmatter.ts`:

```ts
import { issue, type LintRule } from "./rule";

export const frontmatter: LintRule = {
    id: "frontmatter",
    severity: "error",
    description: "The frontmatter matches the schema.",
    check: ({ frontmatterError }) => (frontmatterError === null ? [] : [issue(frontmatter, 1, frontmatterError)]),
};
```

`src/lib/lint/diagram.ts`:

```ts
import { circled } from "../model";
import type { LintIssue } from "../schemas";
import { issue, type LintRule } from "./rule";

export const MAX_DIAGRAM_NODES = 11;

export const nodeNumbers: LintRule = {
    id: "node-numbers",
    severity: "error",
    description:
        "The circled numbers are in sequence and the same in the diagram, the notes list, and the Changes bullets.",
    check: ({ model }) => {
        const diagram = model.diagram;
        const out: LintIssue[] = [];
        const numbers = new Set<number>();
        for (const node of diagram?.nodes ?? []) {
            if (node.number === null) continue;
            if (numbers.has(node.number))
                out.push(issue(nodeNumbers, node.line, `${circled(node.number)} is on more than one node.`));
            numbers.add(node.number);
        }
        for (let n = 1; n <= numbers.size; n += 1) {
            if (!numbers.has(n)) {
                out.push(
                    issue(
                        nodeNumbers,
                        diagram?.line ?? 1,
                        `The node numbers skip ${circled(n)}.`,
                        "Run `diff-digest fmt`.",
                    ),
                );
            }
        }
        for (const change of model.changes) {
            if (change.number !== null && !numbers.has(change.number)) {
                out.push(issue(nodeNumbers, change.line, `${circled(change.number)} is not a node in the diagram.`));
            }
        }
        return out;
    },
};

export const changedNodeMarked: LintRule = {
    id: "changed-node-marked",
    severity: "warn",
    description: "Each changed node has `:::changed` and a circled number.",
    check: ({ model }) => {
        const out: LintIssue[] = [];
        for (const node of model.diagram?.nodes ?? []) {
            if (node.changed && node.number === null) {
                out.push(
                    issue(changedNodeMarked, node.line, `Node "${node.id}" is changed but has no circled number.`),
                );
            }
            if (!node.changed && node.number !== null) {
                out.push(issue(changedNodeMarked, node.line, `Node "${node.id}" has a number but no \`:::changed\`.`));
            }
        }
        return out;
    },
};

export const diagramNotes: LintRule = {
    id: "diagram-notes",
    severity: "warn",
    description: "Each numbered node has a note below the diagram, so the digest makes sense without the picture.",
    check: ({ model }) => {
        const out: LintIssue[] = [];
        const notes = new Set(model.notes.map(n => n.number));
        const nodes = new Set((model.diagram?.nodes ?? []).map(n => n.number));
        for (const node of model.diagram?.nodes ?? []) {
            if (node.number !== null && !notes.has(node.number)) {
                out.push(issue(diagramNotes, node.line, `${circled(node.number)} has no note below the diagram.`));
            }
        }
        for (const note of model.notes) {
            if (note.number === null)
                out.push(issue(diagramNotes, note.line, "This note does not start with a circled number."));
            else if (!nodes.has(note.number))
                out.push(issue(diagramNotes, note.line, `${circled(note.number)} is not a node in the diagram.`));
        }
        return out;
    },
};

export const diagramSize: LintRule = {
    id: "diagram-size",
    severity: "warn",
    description: `The diagram has at most ${MAX_DIAGRAM_NODES} nodes.`,
    check: ({ model }) => {
        const d = model.diagram;
        if (d === null || d.nodes.length <= MAX_DIAGRAM_NODES) return [];
        return [
            issue(
                diagramSize,
                d.line,
                `The diagram has ${d.nodes.length} nodes.`,
                "Show modules and data flow, not functions.",
            ),
        ];
    },
};
```

`src/lib/lint/structure.ts`:

```ts
import type { LintIssue } from "../schemas";
import { issue, type LintRule } from "./rule";

export const KNOWN_SECTIONS: readonly string[] = ["Architecture", "Changes", "Tests"];

export const QUESTIONS = /^questions?$/iu;

export const sectionOrder: LintRule = {
    id: "section-order",
    severity: "warn",
    description: `The known sections are in this order: ${KNOWN_SECTIONS.join(", ")}.`,
    check: ({ model }) => {
        const out: LintIssue[] = [];
        let last = -1;
        for (const section of model.sections) {
            const at = KNOWN_SECTIONS.findIndex(k => k.toLowerCase() === section.title.toLowerCase());
            if (at === -1) continue;
            if (at < last)
                out.push(
                    issue(sectionOrder, section.line, `"${section.title}" is out of order.`, "Run `diff-digest fmt`."),
                );
            last = Math.max(last, at);
        }
        return out;
    },
};

export const unknownSection: LintRule = {
    id: "unknown-section",
    severity: "warn",
    description: "A section is not in the format.",
    check: ({ model }) =>
        model.sections
            .filter(
                s => !QUESTIONS.test(s.title) && !KNOWN_SECTIONS.some(k => k.toLowerCase() === s.title.toLowerCase()),
            )
            .map(s => issue(unknownSection, s.line, `"${s.title}" is not a section of the format.`)),
};

export const noQuestions: LintRule = {
    id: "no-questions",
    severity: "warn",
    description: "No Questions section. Use agent notes.",
    check: ({ model }) =>
        model.sections
            .filter(s => QUESTIONS.test(s.title))
            .map(s =>
                issue(
                    noQuestions,
                    s.line,
                    "The digest has a Questions section.",
                    "Run `diff-digest fmt --questions-to-notes`.",
                ),
            ),
};
```

`src/lib/lint/content.ts`:

```ts
import { anchors } from "../digest";
import type { LintIssue } from "../schemas";
import { inlineLines, issue, type LintRule } from "./rule";

export const MAX_TABLE_COLUMNS = 5;
export const INTENT_PHRASES: readonly string[] = [
    "in order to",
    "the author",
    "intended to",
    "we want",
    "the goal",
    "to make it easier",
];

const WIKILINK = /\[\[[^\]]+\]\]/u;

export const anchorResolves: LintRule = {
    id: "anchor-resolves",
    severity: "error",
    description: "Each anchor resolves to a file and a line range that exists.",
    check: ({ model, ctx }) => {
        const out: LintIssue[] = [];
        for (const block of model.blocks) {
            for (const a of anchors(block.text)) {
                const problem = ctx.checkAnchor(a);
                if (problem !== null) out.push(issue(anchorResolves, block.line, problem));
            }
        }
        return out;
    },
};

export const noIntent: LintRule = {
    id: "no-intent",
    severity: "warn",
    description: `No intent phrases: ${INTENT_PHRASES.map(p => `\`${p}\``).join(", ")}.`,
    check: ({ model }) => {
        const out: LintIssue[] = [];
        for (const block of model.blocks) {
            const lower = block.text.toLowerCase();
            for (const phrase of INTENT_PHRASES) {
                if (lower.includes(phrase))
                    out.push(
                        issue(noIntent, block.line, `"${phrase}" guesses the intent. Describe what the code does.`),
                    );
            }
        }
        return out;
    },
};

export const noInlineHtml: LintRule = {
    id: "no-inline-html",
    severity: "warn",
    description: "No HTML in the body. Some viewers do not render it.",
    check: ({ model }) => {
        const out: LintIssue[] = [];
        for (const b of model.all) if (b.kind === "html") out.push(issue(noInlineHtml, b.line, "HTML block."));
        for (const { line, inline } of inlineLines(model.all)) {
            if (inline.some(i => i.kind === "html")) out.push(issue(noInlineHtml, line, "Inline HTML."));
        }
        return out;
    },
};

export const noWikilinks: LintRule = {
    id: "no-wikilinks",
    severity: "warn",
    description: "No `[[x]]` links. Only Obsidian renders them.",
    check: ({ model }) =>
        inlineLines(model.all)
            .filter(({ inline }) => inline.some(i => i.kind === "text" && WIKILINK.test(i.text)))
            .map(({ line }) => issue(noWikilinks, line, "Wikilink.", "Use a standard [text](url) link.")),
};

export const linkStyle: LintRule = {
    id: "link-style",
    severity: "warn",
    description: "Only standard `[text](url)` links and autolinks.",
    check: ({ model }) => {
        const out: LintIssue[] = [];
        for (const b of model.all)
            if (b.kind === "def") out.push(issue(linkStyle, b.line, "Reference link definition."));
        for (const { line, inline } of inlineLines(model.all)) {
            for (const i of inline) {
                if (i.kind === "link" && i.raw.startsWith("[") && !i.raw.includes("](")) {
                    out.push(issue(linkStyle, line, `Reference link ${i.raw}.`, "Use [text](url)."));
                }
            }
        }
        return out;
    },
};

export const tableMaxColumns: LintRule = {
    id: "table-max-columns",
    severity: "warn",
    description: `Tables have at most ${MAX_TABLE_COLUMNS} columns, so they fit in a terminal viewer.`,
    check: ({ model }) =>
        model.all
            .filter(b => b.kind === "table" && b.header.length > MAX_TABLE_COLUMNS)
            .map(b => issue(tableMaxColumns, b.line, `The table has more than ${MAX_TABLE_COLUMNS} columns.`)),
};
```

`src/lib/lint/index.ts`:

```ts
// Lint rules for a digest (spec §9). Errors are facts that are wrong; warnings are best practices.
// No rule rejects valid Markdown.
import { DigestError } from "../errors";
import { parseDigest } from "../frontmatter";
import { buildModel } from "../model";
import type { LintIssue } from "../schemas";
import { anchorResolves, linkStyle, noInlineHtml, noIntent, noWikilinks, tableMaxColumns } from "./content";
import { changedNodeMarked, diagramNotes, diagramSize, nodeNumbers } from "./diagram";
import { frontmatter } from "./frontmatter";
import type { LintContext, LintInput, LintRule } from "./rule";
import { noQuestions, sectionOrder, unknownSection } from "./structure";

export type { LintContext, LintRule } from "./rule";
export { INTENT_PHRASES, MAX_TABLE_COLUMNS } from "./content";
export { MAX_DIAGRAM_NODES } from "./diagram";
export { KNOWN_SECTIONS } from "./structure";

export const RULES: readonly LintRule[] = [
    frontmatter,
    anchorResolves,
    nodeNumbers,
    changedNodeMarked,
    diagramNotes,
    diagramSize,
    sectionOrder,
    unknownSection,
    noQuestions,
    noIntent,
    noInlineHtml,
    noWikilinks,
    linkStyle,
    tableMaxColumns,
];

const FRONTMATTER_BLOCK = /^---\n[\s\S]*?\n---\n?/u;

/** Lints a full digest file (frontmatter + body). Issues are sorted by line. */
export function lintDigest(md: string, ctx: LintContext): LintIssue[] {
    let frontmatterError: string | null = null;
    let body = md.replace(FRONTMATTER_BLOCK, "");
    try {
        body = parseDigest(md).body;
    } catch (error) {
        if (!(error instanceof DigestError)) throw error;
        frontmatterError = error.message;
    }
    const lineOffset = md.slice(0, md.length - body.length).split("\n").length - 1;
    const input: LintInput = { model: buildModel(body, lineOffset), frontmatterError, ctx };
    return RULES.flatMap(rule => rule.check(input)).toSorted((a, b) => a.line - b.line);
}

export function hasErrors(issues: readonly LintIssue[]): boolean {
    return issues.some(i => i.severity === "error");
}

/** The rule table that `diff-digest format` prints after docs/format.md. */
export function formatRulesMarkdown(): string {
    const rows = RULES.map(r => `| \`${r.id}\` | ${r.severity} | ${r.description.replaceAll("|", String.raw`\|`)} |`);
    return ["## Lint rules", "", "| Rule | Severity | Check |", "|---|---|---|", ...rows, ""].join("\n");
}
```

- [ ] **Step 5: Run the test to make sure that it passes**

Run: `bun test test/lib/lint.test.ts`
Expected: 11 pass, 0 fail.

- [ ] **Step 6: Run the full check**

Run: `bun run verify`
Expected: all steps pass. 63 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/schemas.ts src/lib/lint test/lib/lint.test.ts
git commit -m "minor: add digest lint rules"
```

### Task 4: Safe fixes (fmt)

**Files:**
- Create: `src/lib/fmt.ts`
- Test: `test/lib/fmt.test.ts`

**Interfaces:**
- Consumes: `parseBlocks`, `Block` (Task 1); `buildModel`, `circled`, `leadingNumber` (Task 2); `KNOWN_SECTIONS`, `QUESTIONS` (Task 3, `src/lib/lint/structure.ts`); `GOOD_BODY` (Task 2).
- Produces: `CHANGED_CLASS_DEF`, `interface FmtOptions { questionsToNotes }`, `interface FmtResult { body; questions }`, `orderSections(body)`, `questionsToNotes(body) → FmtResult`, `renumber(body)`, `addChangedClassDef(body)`, `anchorStyle(body)`, `tableStyle(body)`, `formatDigest(body, options) → FmtResult`. Each fix returns the body unchanged when there is nothing to fix. `formatDigest` is idempotent.
- Plan 4's `fmt` command makes an agent note from each returned question.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import {
    addChangedClassDef,
    anchorStyle,
    CHANGED_CLASS_DEF,
    formatDigest,
    orderSections,
    questionsToNotes,
    renumber,
    tableStyle,
} from "../../src/lib/fmt";
import { GOOD_BODY } from "../fixtures/digest";

const MESSY = `# Title

## Tests

| Test|Proves |
|:--|--:|
|t|x|

## Questions

- Q1: does x happen?

## Changes

- ③ retry: \`src/api.ts:10-10\`
- ① view: \`v.ts:2\`

## Architecture

\`\`\`mermaid
flowchart LR
  api["③ API"]:::changed --> view["① View"]:::changed
\`\`\`

1. ③ api retries.
2. ① view badge.
`;

describe("fmt fixes", () => {
    test("orderSections puts known sections in order and keeps all text", () => {
        const out = orderSections(MESSY);
        expect(out.indexOf("## Architecture")).toBeLessThan(out.indexOf("## Changes"));
        expect(out.indexOf("## Changes")).toBeLessThan(out.indexOf("## Tests"));
        expect(out.indexOf("## Tests")).toBeLessThan(out.indexOf("## Questions"));
        expect(out).toContain("- Q1: does x happen?");
    });

    test("questionsToNotes removes the section and returns its items", () => {
        const { body, questions } = questionsToNotes(MESSY);
        expect(body).not.toContain("## Questions");
        expect(questions).toEqual(["Q1: does x happen?"]);
    });

    test("renumber follows the diagram order in the diagram, the notes, and Changes", () => {
        const out = renumber(orderSections(MESSY));
        expect(out).toContain('api["① API"]:::changed --> view["② View"]:::changed');
        expect(out).toContain("1. ① api retries.\n2. ② view badge.");
        expect(out).toContain("- ① retry:");
        expect(out).toContain("- ② view:");
    });

    test("addChangedClassDef adds the line before the closing fence", () => {
        expect(addChangedClassDef(MESSY)).toContain(`:::changed\n${CHANGED_CLASS_DEF}\n\`\`\``);
    });

    test("anchorStyle shortens a one-line range and leaves code blocks alone", () => {
        const out = anchorStyle("- `a.ts:3-3` and `b.ts:3-4`\n\n```\n`c.ts:5-5`\n```\n");
        expect(out).toBe("- `a.ts:3` and `b.ts:3-4`\n\n```\n`c.ts:5-5`\n```\n");
    });

    test("tableStyle uses one row style and keeps alignment and escaped pipes", () => {
        expect(tableStyle("| a|b \\| c |\n|:--|--:|\n|1|2|\n")).toBe("| a | b \\| c |\n|:---|---:|\n| 1 | 2 |\n");
    });
});

describe("formatDigest", () => {
    test("does not change a good digest", () => {
        expect(formatDigest(GOOD_BODY, { questionsToNotes: true }).body).toBe(GOOD_BODY);
    });

    test("is idempotent", () => {
        const once = formatDigest(MESSY, { questionsToNotes: true });
        expect(once.questions).toEqual(["Q1: does x happen?"]);
        expect(formatDigest(once.body, { questionsToNotes: true })).toEqual({ body: once.body, questions: [] });
        const keep = formatDigest(MESSY, { questionsToNotes: false });
        expect(keep.body).toContain("## Questions");
        expect(formatDigest(keep.body, { questionsToNotes: false }).body).toBe(keep.body);
    });
});
```

- [ ] **Step 2: Run the test to make sure that it fails**

Run: `bun test test/lib/fmt.test.ts`
Expected: FAIL. The module `../../src/lib/fmt` is not found.

- [ ] **Step 3: Create `src/lib/fmt.ts`**

```ts
// Safe auto-fixes for a digest body (spec §9). Each fix keeps the meaning and never deletes
// content. Only `questionsToNotes` removes a section, and it returns the text it removed.
import { KNOWN_SECTIONS, QUESTIONS } from "./lint/structure";
import { parseBlocks, type Block } from "./md";
import { buildModel, circled, leadingNumber } from "./model";

export const CHANGED_CLASS_DEF = "  classDef changed stroke:#ffc430,stroke-width:2px";

export interface FmtOptions {
    readonly questionsToNotes: boolean;
}

export interface FmtResult {
    readonly body: string;
    /** The questions that `questionsToNotes` removed, one per list item or paragraph. */
    readonly questions: readonly string[];
}

const SHORT_RANGE = /`([\w@#./-]+\.\w+):(\d+)-\2`/gu;
const CIRCLED_ANY = /[①-⑳]/u;
const CIRCLED_ALL = /[①-⑳]/gu;
const LIST_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+)/u;
const PIPE = /(?<!\\)\|/u;

interface Chunk {
    readonly title: string | null;
    readonly text: string;
}

/** The last line (1-based) of a block, from its raw text. */
function endLine(block: Block): number {
    return block.line + block.raw.replace(/\n+$/u, "").split("\n").length - 1;
}

function chunks(body: string): Chunk[] {
    const lines = body.split("\n");
    const heads = parseBlocks(body).filter(b => b.kind === "heading" && b.depth === 2);
    const out: Chunk[] = [{ title: null, text: lines.slice(0, (heads[0]?.line ?? lines.length + 1) - 1).join("\n") }];
    for (const [i, head] of heads.entries()) {
        const end = (heads[i + 1]?.line ?? lines.length + 1) - 1;
        const title = head.kind === "heading" ? head.text.trim() : "";
        out.push({ title, text: lines.slice(head.line - 1, end).join("\n") });
    }
    return out;
}

function join(parts: readonly string[]): string {
    const kept = parts.map(p => p.replace(/\n+$/u, "")).filter(p => p.trim() !== "");
    return `${kept.join("\n\n")}\n`;
}

function rank(title: string | null): number {
    if (title === null) return -1;
    const known = KNOWN_SECTIONS.findIndex(k => k.toLowerCase() === title.toLowerCase());
    return known === -1 ? KNOWN_SECTIONS.length : known;
}

export function orderSections(body: string): string {
    const all = chunks(body);
    const sorted = all.toSorted((a, b) => rank(a.title) - rank(b.title));
    if (sorted.every((c, i) => c === all[i])) return body;
    return join(sorted.map(c => c.text));
}

export function questionsToNotes(body: string): FmtResult {
    const all = chunks(body);
    const questions: string[] = [];
    for (const c of all) {
        if (c.title === null || !QUESTIONS.test(c.title)) continue;
        for (const b of parseBlocks(c.text)) {
            if (b.kind === "list") for (const item of b.items) questions.push(item.text.trim());
            if (b.kind === "paragraph") questions.push(b.text.trim());
        }
    }
    if (questions.length === 0 && all.every(c => c.title === null || !QUESTIONS.test(c.title)))
        return { body, questions };
    return { body: join(all.filter(c => c.title === null || !QUESTIONS.test(c.title)).map(c => c.text)), questions };
}

function replaceLeadingNumber(line: string, next: (n: number) => number | undefined): string {
    const marker = LIST_MARKER.exec(line)?.[1] ?? "";
    const rest = line.slice(marker.length);
    const old = leadingNumber(rest);
    const to = old === null ? undefined : next(old);
    return to === undefined ? line : `${marker}${rest.replace(CIRCLED_ANY, circled(to))}`;
}

/** Renumbers the changed nodes 1..n in the order of the diagram, in the diagram, the notes, and Changes. */
export function renumber(body: string): string {
    const model = buildModel(body);
    const diagram = model.diagram;
    if (diagram === null) return body;
    const numbers = diagram.nodes.flatMap(n => (n.number === null ? [] : [n.number]));
    if (new Set(numbers).size !== numbers.length) return body;
    if (numbers.every((n, i) => n === i + 1)) return body;
    const map = new Map(numbers.map((n, i) => [n, i + 1]));
    const next = (n: number): number | undefined => map.get(n);
    const lines = body.split("\n");
    const fence = parseBlocks(body).find(b => b.kind === "code" && b.line === diagram.line);
    const last = fence === undefined ? diagram.line : endLine(fence);
    for (let i = diagram.line; i < last; i += 1) {
        lines[i] = (lines[i] ?? "").replaceAll(CIRCLED_ALL, c => {
            const n = leadingNumber(c);
            const to = n === null ? undefined : next(n);
            return to === undefined ? c : circled(to);
        });
    }
    for (const item of [...model.notes, ...model.changes]) {
        lines[item.line - 1] = replaceLeadingNumber(lines[item.line - 1] ?? "", next);
    }
    return lines.join("\n");
}

/** Adds the `classDef changed` line when a node is changed and the diagram has no such line. */
export function addChangedClassDef(body: string): string {
    const diagram = buildModel(body).diagram;
    if (diagram === null || diagram.hasChangedClassDef || !diagram.nodes.some(n => n.changed)) return body;
    const fence = parseBlocks(body).find(b => b.kind === "code" && b.line === diagram.line);
    if (fence === undefined) return body;
    const lines = body.split("\n");
    lines.splice(endLine(fence) - 1, 0, CHANGED_CLASS_DEF);
    return lines.join("\n");
}

function codeLines(blocks: readonly Block[]): Set<number> {
    const out = new Set<number>();
    for (const b of blocks) if (b.kind === "code") for (let l = b.line; l <= endLine(b); l += 1) out.add(l);
    return out;
}

/** `a.ts:3-3` becomes `a.ts:3`. Code blocks do not change. */
export function anchorStyle(body: string): string {
    const code = codeLines(parseBlocks(body));
    return body
        .split("\n")
        .map((line, i) => (code.has(i + 1) ? line : line.replaceAll(SHORT_RANGE, "`$1:$2`")))
        .join("\n");
}

function tableRow(line: string, delimiter: boolean): string {
    const cells = line
        .trim()
        .replace(/^\|/u, "")
        .replace(/(?<!\\)\|$/u, "")
        .split(PIPE)
        .map(c => c.trim());
    if (!delimiter) return `| ${cells.join(" | ")} |`;
    const marks = cells.map(c => `${c.startsWith(":") ? ":" : ""}---${c.endsWith(":") ? ":" : ""}`);
    return `|${marks.join("|")}|`;
}

/** Every table row becomes `| a | b |`, and the delimiter row becomes `|---|---|` (alignment kept). */
export function tableStyle(body: string): string {
    const lines = body.split("\n");
    for (const b of parseBlocks(body)) {
        if (b.kind !== "table") continue;
        for (let l = b.line; l <= endLine(b); l += 1) lines[l - 1] = tableRow(lines[l - 1] ?? "", l === b.line + 1);
    }
    return lines.join("\n");
}

export function formatDigest(body: string, options: FmtOptions): FmtResult {
    const moved = options.questionsToNotes ? questionsToNotes(body) : { body, questions: [] };
    const fixed = [orderSections, renumber, addChangedClassDef, anchorStyle, tableStyle].reduce(
        (text, fix) => fix(text),
        moved.body,
    );
    return { body: fixed, questions: moved.questions };
}
```

- [ ] **Step 4: Run the test to make sure that it passes**

Run: `bun test test/lib/fmt.test.ts`
Expected: 8 pass, 0 fail.

- [ ] **Step 5: Run the full check**

Run: `bun run verify`
Expected: all steps pass. 71 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fmt.ts test/lib/fmt.test.ts
git commit -m "minor: add safe digest fixes"
```

### Task 5: Anchor links (render)

**Files:**
- Create: `src/lib/render.ts`
- Test: `test/lib/render.test.ts`

**Interfaces:**
- Consumes: `ANCHOR`, `Anchor` (`src/lib/digest.ts`); `parseBlocks` (Task 1); `GOOD_BODY` (Task 2).
- Produces: `type AnchorLinker = (anchor: Anchor) => string | null`, `renderLinks(body, link) → string`, `unrenderLinks(body) → string`. `unrenderLinks(renderLinks(body, link)) === body` for a body with no anchor links. `renderLinks` is idempotent. Code blocks do not change.
- Plan 5's backends give the `AnchorLinker` and add their envelope around the rendered body.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { renderLinks, unrenderLinks, type AnchorLinker } from "../../src/lib/render";
import { GOOD_BODY } from "../fixtures/digest";

const LINK: AnchorLinker = a => `https://x.dev/blob/sha/${a.path}#L${a.start}-L${a.end}`;

describe("render", () => {
    test("links each anchor, and unrender gives the same body back", () => {
        const rendered = renderLinks(GOOD_BODY, LINK);
        expect(rendered).toContain("[`src/api.ts:10-14`](https://x.dev/blob/sha/src/api.ts#L10-L14)");
        expect(unrenderLinks(rendered)).toBe(GOOD_BODY);
    });

    test("renders an already rendered body to the same text", () => {
        const once = renderLinks(GOOD_BODY, LINK);
        expect(renderLinks(once, LINK)).toBe(once);
    });

    test("a null link keeps the code span, and code blocks do not change", () => {
        const body = "- `a.ts:1`\n\n```\n`b.ts:2`\n```\n";
        expect(renderLinks(body, () => null)).toBe(body);
        expect(renderLinks(body, LINK)).toBe("- [`a.ts:1`](https://x.dev/blob/sha/a.ts#L1-L1)\n\n```\n`b.ts:2`\n```\n");
    });

    test("the rendered body has no HTML", () => {
        expect(renderLinks(GOOD_BODY, LINK)).not.toMatch(/<[a-z!/]/u);
    });
});
```

- [ ] **Step 2: Run the test to make sure that it fails**

Run: `bun test test/lib/render.test.ts`
Expected: FAIL. The module `../../src/lib/render` is not found.

- [ ] **Step 3: Create `src/lib/render.ts`**

```ts
// Anchor links for published digests (spec §5.3). Pure: the UI imports this file.
import { ANCHOR, type Anchor } from "./digest";
import { parseBlocks } from "./md";

/** The URL for an anchor, or null to leave the anchor as a plain code span. */
export type AnchorLinker = (anchor: Anchor) => string | null;

const LINKED_ANCHOR = /\[(`[\w@#./-]+\.\w+:\d+(?:-\d+)?`)\]\([^)\s]+\)/gu;

function codeLines(body: string): Set<number> {
    const out = new Set<number>();
    for (const b of parseBlocks(body)) {
        if (b.kind !== "code") continue;
        const count = b.raw.replace(/\n+$/u, "").split("\n").length;
        for (let l = b.line; l < b.line + count; l += 1) out.add(l);
    }
    return out;
}

function mapLines(body: string, fix: (line: string) => string): string {
    const code = codeLines(body);
    return body
        .split("\n")
        .map((line, i) => (code.has(i + 1) ? line : fix(line)))
        .join("\n");
}

/** `[\`a.ts:3\`](url)` becomes `` `a.ts:3` ``. Other links and code blocks do not change. */
export function unrenderLinks(body: string): string {
    return mapLines(body, line => line.replaceAll(LINKED_ANCHOR, "$1"));
}

/** Each anchor code span becomes a link when `link` returns a URL. Already linked anchors are linked once. */
export function renderLinks(body: string, link: AnchorLinker): string {
    return mapLines(unrenderLinks(body), line =>
        line.replaceAll(ANCHOR, (match: string, path: string, start: string, end: string | undefined) => {
            const url = link({ path, start: Number(start), end: Number(end ?? start) });
            return url === null ? match : `[${match}](${url})`;
        }),
    );
}
```

- [ ] **Step 4: Run the test to make sure that it passes**

Run: `bun test test/lib/render.test.ts`
Expected: 4 pass, 0 fail.

- [ ] **Step 5: Run the full check**

Run: `bun run verify`
Expected: all steps pass. 75 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/render.ts test/lib/render.test.ts
git commit -m "minor: add anchor link render and unrender"
```

---

## Carry-forward for plans 3–7

| Plan | Item |
|---|---|
| 3 | Concurrent writes to `*.comments.json` and `config.json` (plan 1 carry-forward). |
| 3 | `workingCopyPath` must slug or validate its arguments (plan 1 carry-forward). |
| 4 | `lint` / `check` commands: give `lintDigest` a `checkAnchor` that resolves the path against the changed files and the tracked files, and checks the line range against the file length. `check` = `lintDigest` + `coverageGaps`. |
| 4 | `fmt` command: write the fixed body with `serializeDigest`, and make an agent note for each returned question. Its target is the block with the digest title (`model.title`). |
| 4 | `format` command: print `docs/format.md`, then `formatRulesMarkdown()`. Update `docs/format.md` in plan 7 so that it has no rule list of its own. |
| 4 | `resolveBase` head type (plan 1 carry-forward). |
| 5 | Backends call `renderLinks` with their `anchorLink` and add their envelope; `pull` calls `unrenderLinks`. |
| 6 | The UI renders from `parseBlocks` and takes block ids from `buildModel(...).blocks`, so the UI, the linter, and comments use the same `cid`. Add the `react-hooks` plugin (plan 1 carry-forward). |

