# Plan 1: Foundation (tooling + lib core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the strict TypeScript toolchain and the `src/lib` core (schemas, errors, paths, git, diff, coverage, frontmatter, store, config) with tests. The old `bin/` CLI keeps working.

**Architecture:** `src/lib` is a set of small modules with no globals. Each git operation takes a `RepoContext { root, base, head }`. zod schemas in `schemas.ts` are the only source of the data types. The code is a port of the current behavior in `bin/diff-digest.mjs`, with these changes: no module globals, YAML frontmatter with a schema, a central store path, and a config file schema that rejects unknown keys.

**Tech Stack:** Bun 1.4.2, TypeScript 7.0.2, zod 4.6.5, oxlint 1.86.0 + oxlint-tsgolint 7.0.2003, Prettier 3.9.9, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md`

This is plan 1 of 7:

1. **Foundation** (this plan)
2. Model, lint, fmt, render
3. Contract, router, server lifecycle
4. CLI (Stricli)
5. Backends (github, local)
6. UI (React)
7. Skill, docs, setup, and removal of `bin/`, `ui/`, and `scripts/install.mjs`

## Global Constraints

- Work on `main`. No feature branch.
- Exact versions, no ranges: `zod` 4.6.5, `typescript` 7.0.2, `oxlint` 1.86.0, `oxlint-tsgolint` 7.0.2003, `prettier` 3.9.9, `@types/bun` 1.4.2. Bun 1.4.2 or later.
- `bun run verify` (typecheck + oxlint + suppression check + Prettier check + tests) must pass before each commit.
- No suppression comments and no `suppressions.json` entries without explicit approval from the user (spec §11.3).
- No `as` type assertions, except `as const`. Parse unknown data with zod.
- No `any`. No non-null assertions (`!`).
- Lint config: only the two approved changes in Task 1 Step 5. Do not turn off or weaken any other rule.
- `src/lib` imports nothing from `src/cli`, `src/server`, `src/app`, or React. `src/lib/digest.ts` and `src/lib/schemas.ts` import no Node or Bun API, because the UI imports them.
- Regular expressions use the `u` flag (oxlint `require-unicode-regexp`). Config patterns are also compiled with the `u` flag.
- Commit messages: conventional commits with `minor`, `bugfix`, `major`, or `chore`. No co-author line.
- Documentation is in ASD-STE100 Simple Technical English.
- Do not edit `bin/`, `ui/`, or `scripts/install.mjs` in this plan. Prettier ignores them.

## Notes for the implementer

- oxlint prints nothing when there are no problems. Exit code 0 means pass.
- `pedantic` rules are on. Common findings: `max-lines-per-function` (50 lines, off only in `test/**`), `unicorn/consistent-function-scoping` (move helpers that capture nothing to module scope), `unicorn/prefer-code-point`, `no-new` (a `new` only for side effects).
- `strict-boolean-expressions` is on. Write `s !== ""`, `x !== undefined`, and `x !== null`, not `if (s)`.
- `noUncheckedIndexedAccess` is on. Array destructuring gives `T | undefined`. Check it, or give a default.
- `exactOptionalPropertyTypes` is on. Do not assign `undefined` to an optional property. Leave the key out (`...(x === undefined ? {} : { x })`).
- `no-redeclare` is on. Name each zod schema `XSchema`, and its type `X` (`type ChangedFile = z.infer<typeof ChangedFileSchema>`).
- `prefer-readonly-parameter-types` is on. Every parameter must be deeply readonly, including callback parameters. The schemas use `.readonly()`, so parsed data is readonly. Do not take a `RegExp`, `Map`, `Set`, or mutable array as a parameter. Take a predicate `(path: string) => boolean`, a `Readonly<Record<…>>`, or a `readonly T[]`. To build an array, use a local mutable variable and a `for` loop.
- On macOS, the temp folder is a symlink. Tests use `realpathSync`, because `git rev-parse --show-toplevel` prints the real path.

## File structure

| File | Responsibility |
|---|---|
| `package.json` | Scripts and exact dependency versions |
| `tsconfig.json` | Strict compiler options (spec §11.1) |
| `.oxlintrc.json` | Lint rules (spec §11.2) and folder import limits |
| `.prettierrc.json`, `.prettierignore` | Format (spec §11.4) |
| `suppressions.json` | Approved suppressions. Starts as `[]`. |
| `scripts/check-suppressions.ts` | Fails on a suppression that is not approved |
| `CLAUDE.md` | Rules for agents in this repo |
| `src/lib/errors.ts` | `DigestError`, error codes, exit codes |
| `src/lib/schemas.ts` | zod schemas and the types from them |
| `src/lib/paths.ts` | `~/.diff-digest` paths |
| `src/lib/repo.ts` | `RepoContext`, git wrappers, base, origin, repo keys |
| `src/lib/digest.ts` | Pure helpers: anchors, path match, block ids |
| `src/lib/frontmatter.ts` | Parse and write the digest frontmatter (YAML) |
| `src/lib/diff.ts` | Changed files, classes, hunks, import and move filters |
| `src/lib/coverage.ts` | Hunks that no anchor covers |
| `src/lib/store.ts` | Atomic writes, working copy path, comments file |
| `src/lib/config.ts` | Read, resolve, and change the config file |
| `test/helpers/repo.ts` | Temp git repo and error assertion helpers |

The spec §3 lists `digest.ts` for coverage and frontmatter. This plan puts them in `coverage.ts` and `frontmatter.ts`, because `digest.ts` must stay free of Node and Bun APIs for the UI. `paths.ts` is also new. Task 1 updates the spec layout to match.

---

### Task 1: Strict toolchain and suppression check

**Files:**
- Create: `package.json` (replace the current file)
- Create: `tsconfig.json`
- Create: `.oxlintrc.json`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `suppressions.json`
- Create: `scripts/check-suppressions.ts`
- Create: `CLAUDE.md`
- Modify: `.gitignore` (add `node_modules/` and `dist/`)
- Modify: `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md` (§3 lib file list)
- Test: `test/scripts/check-suppressions.test.ts`

**Interfaces:**
- Produces: `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`, `bun run verify`.
- Produces: `findSuppressions(files: readonly SourceFile[], allowed: readonly Suppression[]): Violation[]`, `SuppressionSchema`, and `type Suppression` in `scripts/check-suppressions.ts`.

- [ ] **Step 1: Replace `package.json`**

The `setup` script stays, because the old installer is used until plan 7.

```json
{
    "name": "diff-digest",
    "version": "0.2.0",
    "description": "Compress a git diff into a short, reviewable change spec with a local review UI.",
    "type": "module",
    "private": true,
    "scripts": {
        "setup": "bun scripts/install.mjs",
        "typecheck": "tsc -p .",
        "lint": "oxlint --type-aware src test scripts && bun scripts/check-suppressions.ts && prettier --check .",
        "format": "prettier --write .",
        "test": "bun test",
        "verify": "bun run typecheck && bun run lint && bun run test"
    },
    "engines": {
        "bun": ">=1.4.2"
    },
    "dependencies": {
        "zod": "4.6.5"
    },
    "devDependencies": {
        "@types/bun": "1.4.2",
        "oxlint": "1.86.0",
        "oxlint-tsgolint": "7.0.2003",
        "prettier": "3.9.9",
        "typescript": "7.0.2"
    }
}
```

- [ ] **Step 2: Install the dependencies**

Run: `bun install`
Expected: `bun.lock` is created, and `node_modules/.bin` has `tsc`, `oxlint`, `tsgolint`, and `prettier`.

- [ ] **Step 3: Add `node_modules/` and `dist/` to `.gitignore`**

Append these two lines to `.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
    "compilerOptions": {
        "target": "esnext",
        "lib": ["esnext", "dom", "dom.iterable"],
        "module": "preserve",
        "moduleResolution": "bundler",
        "types": ["bun"],
        "noEmit": true,
        "jsx": "react-jsx",
        "strict": true,
        "noUncheckedIndexedAccess": true,
        "exactOptionalPropertyTypes": true,
        "noImplicitOverride": true,
        "noImplicitReturns": true,
        "noPropertyAccessFromIndexSignature": true,
        "noFallthroughCasesInSwitch": true,
        "noUnusedLocals": true,
        "noUnusedParameters": true,
        "allowUnreachableCode": false,
        "allowUnusedLabels": false,
        "verbatimModuleSyntax": true,
        "erasableSyntaxOnly": true,
        "isolatedModules": true,
        "skipLibCheck": false
    },
    "include": ["src", "scripts", "test"]
}
```

- [ ] **Step 5: Create `.oxlintrc.json`**

The user approved exactly two changes from the full strict rule set. Do not add more without the user's approval:
- `max-lines-per-function` is off in `test/**` only, because `describe` blocks are long. It stays on (50 lines) in `src/` and `scripts/`.
- `typescript/prefer-readonly-parameter-types` has one `allow` entry: the `Sha` type from `src/lib/schemas.ts`. tsgolint counts the string methods of a branded string as mutable when the brand is inside an object.

`ignorePatterns` skips `scripts/install.mjs`, the old JavaScript installer. Plan 7 deletes it. Do not edit it in this plan.

```json
{
    "$schema": "./node_modules/oxlint/configuration_schema.json",
    "ignorePatterns": ["scripts/install.mjs"],
    "plugins": ["typescript", "unicorn", "import", "promise", "react"],
    "categories": {
        "correctness": "error",
        "suspicious": "error",
        "perf": "error",
        "pedantic": "error"
    },
    "rules": {
        "typescript/ban-ts-comment": [
            "error",
            {
                "ts-expect-error": true,
                "ts-ignore": true,
                "ts-nocheck": true,
                "ts-check": false
            }
        ],
        "typescript/consistent-type-assertions": [
            "error",
            {
                "assertionStyle": "never"
            }
        ],
        "typescript/consistent-type-imports": "error",
        "typescript/no-explicit-any": "error",
        "typescript/no-non-null-assertion": "error",
        "typescript/no-unsafe-assignment": "error",
        "typescript/no-unsafe-call": "error",
        "typescript/no-unsafe-member-access": "error",
        "typescript/no-unsafe-return": "error",
        "typescript/no-unsafe-argument": "error",
        "typescript/no-floating-promises": "error",
        "typescript/no-misused-promises": "error",
        "typescript/await-thenable": "error",
        "typescript/require-await": "error",
        "typescript/switch-exhaustiveness-check": "error",
        "typescript/strict-boolean-expressions": "error",
        "typescript/no-unnecessary-condition": "error",
        "typescript/prefer-nullish-coalescing": "error",
        "typescript/prefer-readonly-parameter-types": [
            "error",
            {
                "allow": [
                    {
                        "from": "file",
                        "name": "Sha",
                        "path": "src/lib/schemas.ts"
                    }
                ]
            }
        ]
    },
    "overrides": [
        {
            "files": ["src/lib/**"],
            "rules": {
                "no-console": "error",
                "no-restricted-imports": [
                    "error",
                    {
                        "patterns": [
                            {
                                "group": ["../cli/*", "../server/*", "../app/*", "react", "react-dom"],
                                "message": "src/lib must not import other src folders or React."
                            }
                        ]
                    }
                ]
            }
        },
        {
            "files": ["test/**"],
            "rules": {
                "max-lines-per-function": "off"
            }
        }
    ]
}
```

- [ ] **Step 6: Create `.prettierrc.json` and `.prettierignore`**

```json
{
    "printWidth": 120,
    "tabWidth": 4,
    "trailingComma": "all",
    "arrowParens": "avoid"
}
```

`.prettierignore`:

```
node_modules/
dist/
bin/
ui/
scripts/install.mjs
*.md
bun.lock
```

- [ ] **Step 7: Create `suppressions.json`**

```json
[]
```

- [ ] **Step 8: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { findSuppressions, type Suppression } from "../../scripts/check-suppressions";

const IGNORE = ["// @ts", "-ignore"].join("");
const DISABLE = ["// oxlint", "-disable-next-line no-console"].join("");

describe("findSuppressions", () => {
    test("reports each banned comment with its line", () => {
        const files = [{ path: "src/a.ts", text: `const a = 1;\n${IGNORE}\nconst b = 2;\n${DISABLE}\n` }];
        expect(findSuppressions(files, [])).toEqual([
            { path: "src/a.ts", line: 2, match: ["@ts", "-ignore"].join("") },
            { path: "src/a.ts", line: 4, match: ["oxlint", "-disable"].join("") },
        ]);
    });

    test("an approved entry for the same file, text, and rule is allowed", () => {
        const allowed: Suppression[] = [
            { file: "src/a.ts", text: "oxlint", rule: "no-console", reason: "CLI output", approvedBy: "zfaria" },
        ];
        const files = [
            { path: "src/a.ts", text: DISABLE },
            { path: "src/b.ts", text: DISABLE },
        ];
        expect(findSuppressions(files, allowed)).toEqual([
            { path: "src/b.ts", line: 1, match: ["oxlint", "-disable"].join("") },
        ]);
    });
});
```

- [ ] **Step 9: Run the test to make sure that it fails**

Run: `bun test test/scripts/check-suppressions.test.ts`
Expected: FAIL. The module `../../scripts/check-suppressions` is not found.

- [ ] **Step 10: Create `scripts/check-suppressions.ts`**

```ts
// Fails when a file in src/, scripts/, or test/ has a lint, type, or format suppression
// that suppressions.json does not list. Only the user adds entries to suppressions.json.
import { readFileSync } from "node:fs";
import { z } from "zod";

// Built from parts, so this file does not match itself.
const BANNED: readonly string[] = (
    [
        ["@ts", "-ignore"],
        ["@ts", "-expect-error"],
        ["@ts", "-nocheck"],
        ["oxlint", "-disable"],
        ["eslint", "-disable"],
        ["prettier", "-ignore"],
    ] as const
).map(parts => parts.join(""));

export const SuppressionSchema = z.strictObject({
    file: z.string().min(1),
    /** Text that the suppressed line must contain. */
    text: z.string().min(1),
    rule: z.string().min(1),
    reason: z.string().min(1),
    approvedBy: z.string().min(1),
});
export type Suppression = z.infer<typeof SuppressionSchema>;

export interface SourceFile {
    readonly path: string;
    readonly text: string;
}

export interface Violation {
    readonly path: string;
    readonly line: number;
    readonly match: string;
}

export function findSuppressions(files: readonly SourceFile[], allowed: readonly Suppression[]): Violation[] {
    const violations: Violation[] = [];
    for (const file of files) {
        for (const [i, line] of file.text.split("\n").entries()) {
            const match = BANNED.find(b => line.includes(b));
            if (match === undefined) continue;
            const ok = allowed.some(a => a.file === file.path && line.includes(a.text) && line.includes(a.rule));
            if (!ok) violations.push({ path: file.path, line: i + 1, match });
        }
    }
    return violations;
}

function main(): void {
    const allowed = z.array(SuppressionSchema).parse(JSON.parse(readFileSync("suppressions.json", "utf8")));
    const files: SourceFile[] = [];
    for (const path of new Bun.Glob("{src,scripts,test}/**/*.{ts,tsx,js,mjs,css,html}").scanSync(".")) {
        files.push({ path, text: readFileSync(path, "utf8") });
    }
    const violations = findSuppressions(files, allowed);
    for (const v of violations) {
        console.error(
            `${v.path}:${v.line}: "${v.match}" is not allowed. Ask the user, then add it to suppressions.json.`,
        );
    }
    if (violations.length > 0) process.exit(1);
}

if (import.meta.main) main();
```

- [ ] **Step 11: Run the test to make sure that it passes**

Run: `bun test test/scripts/check-suppressions.test.ts`
Expected: 2 pass, 0 fail.

- [ ] **Step 12: Make sure that the check catches a real suppression**

Run:

```bash
printf '// @ts-%s\n' ignore > scripts/zz.ts && bun scripts/check-suppressions.ts; echo "exit=$?"; rm scripts/zz.ts
```

Expected: `scripts/zz.ts:1: "@ts-ignore" is not allowed. …` and `exit=1`.

- [ ] **Step 13: Create `CLAUDE.md`**

```markdown
# diff-digest

- Run `bun run verify` before each commit. It must pass.
- Do not add a lint, type, or format suppression (for example `@ts-expect-error` or an `oxlint-disable` comment). Do not add an entry to `suppressions.json`. Do not turn off a lint rule or a compiler option. If you think that one is necessary, stop and ask the user first.
- Do not use `as` type assertions. Parse unknown data with the zod schemas in `src/lib/schemas.ts`. `as const` is allowed.
- Name each zod schema `XSchema`, and its type `X`. Schemas use `.readonly()`. Build new values; do not change parsed values.
- `src/lib` must not import from `src/cli`, `src/server`, `src/app`, or React. Files that the UI imports (`src/lib/digest.ts`, `src/lib/schemas.ts`) must not import Node or Bun APIs.
- Write documentation in ASD-STE100 Simple Technical English.
- Commits use conventional commits with the types `minor`, `bugfix`, `major`, and `chore`. Do not add a co-author line.
- The design is in `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md`.
```

- [ ] **Step 14: Update the spec layout**

In `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md` §3, replace the line

```
    digest.ts         frontmatter, block ids (cid), anchors, coverage
```

with

```
    paths.ts          ~/.diff-digest paths
    digest.ts         pure helpers for the UI too: block ids (cid), anchors, path match
    frontmatter.ts    parse and write the frontmatter (YAML)
    coverage.ts       hunks that no anchor covers
```

- [ ] **Step 15: Run the full check**

Run: `bun run verify`
Expected: the typecheck, oxlint, the suppression check, and Prettier pass. 2 tests pass. If Prettier reports a file, run `bun run format` and run `verify` again.

- [ ] **Step 16: Commit**

```bash
git add package.json bun.lock .gitignore tsconfig.json .oxlintrc.json .prettierrc.json .prettierignore suppressions.json scripts/check-suppressions.ts test/scripts/check-suppressions.test.ts CLAUDE.md docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md
git commit -m "chore: add strict TypeScript toolchain and suppression check"
```

### Task 2: Errors, schemas, paths, and the git layer

**Files:**
- Create: `src/lib/errors.ts`
- Create: `src/lib/schemas.ts`
- Create: `src/lib/paths.ts`
- Create: `src/lib/repo.ts`
- Create: `test/helpers/repo.ts`
- Test: `test/lib/repo.test.ts`

**Interfaces:**
- Consumes: the toolchain from Task 1.
- Produces (`errors.ts`): `ERROR_CODES`, `type ErrorCode`, `EXIT_CODES: Readonly<Record<ErrorCode, number>>`, `class DigestError(code, message, options?: { hint?, data?, cause? })` with `code`, `hint`, `data`, `toJSON()`.
- Produces (`schemas.ts`): the type `Sha` (branded string), `isSha(value): value is Sha`, and these schema/type pairs: `ShaSchema`, `FileStatusSchema`/`FileStatus`, `FileClassSchema`/`FileClass`, `ChangedFileSchema`/`ChangedFile { status, path, oldPath, cls, untracked }`, `DiffLineSchema`/`DiffLine { n, text }`, `HunkSchema`/`Hunk { start, end, oldStart, oldCount, newStart, newCount, removed, added, size }`, `BackendConfigSchema`/`BackendConfig`, `RepoConfigSchema`/`RepoConfig`, `ConfigFileSchema`/`ConfigFile`, `FrontmatterSchema`/`Frontmatter { id, branch, base, head: Sha | null, pinned, meta }`, `CommentTargetSchema`/`CommentTarget`, `CommentSchema`/`Comment`, `CommentsFileSchema`. All types are deeply readonly.
- Produces (`paths.ts`): `homeDir()`, `configPath(home?)`, `storeDir(home?)`, `expandHome(path)`.
- Produces (`repo.ts`): `EMPTY_TREE: Sha`, `type Head = "worktree" | Sha`, `interface RepoContext { root; base: Sha; head: Head }`, `runGit(root, args, input?) → GitResult`, `git(root, args, input?) → string`, `findRepoRoot(cwd)`, `tryRev(root, ref) → Sha | null`, `rev(root, ref) → Sha`, `hasCommit`, `mergeBase`, `currentBranch`, `resolveBase(root, ref?, head = "HEAD") → Sha`, `originRepo(root) → OriginRepo | null`, `repoKeys(root) → readonly [string, ...string[]]`, `short(sha)`, `slug(value)`.
- Produces (`test/helpers/repo.ts`): `makeRepo() → TestRepo { root, write(path, content), commit(message) → Sha, remove() }`, `tempDir(prefix)`, `expectDigestError(run, code) → DigestError`.

- [ ] **Step 1: Create `src/lib/errors.ts`**

```ts
export const ERROR_CODES = [
    "BAD_INPUT",
    "NOT_FOUND",
    "LINT_FAILED",
    "COVERAGE_GAP",
    "STALE",
    "NO_BACKEND",
    "BACKEND_FAILED",
    "BAD_CONFIG",
    "SERVER_DOWN",
    "GIT_FAILED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Exit code for each error code. Usage errors from the CLI parser exit with 2. */
export const EXIT_CODES: Readonly<Record<ErrorCode, number>> = {
    BAD_INPUT: 3,
    NOT_FOUND: 4,
    LINT_FAILED: 5,
    COVERAGE_GAP: 6,
    STALE: 7,
    NO_BACKEND: 8,
    BACKEND_FAILED: 9,
    BAD_CONFIG: 10,
    SERVER_DOWN: 11,
    GIT_FAILED: 12,
};

export interface DigestErrorOptions {
    hint?: string;
    data?: unknown;
    cause?: unknown;
}

export class DigestError extends Error {
    readonly code: ErrorCode;
    readonly hint: string | undefined;
    readonly data: unknown;

    constructor(code: ErrorCode, message: string, options: Readonly<DigestErrorOptions> = {}) {
        super(message, { cause: options.cause });
        this.name = "DigestError";
        this.code = code;
        this.hint = options.hint;
        this.data = options.data;
    }

    toJSON(): { code: ErrorCode; message: string; hint?: string; data?: unknown } {
        return {
            code: this.code,
            message: this.message,
            ...(this.hint === undefined ? {} : { hint: this.hint }),
            ...(this.data === undefined ? {} : { data: this.data }),
        };
    }
}
```

- [ ] **Step 2: Create `src/lib/schemas.ts`**

This file holds the final shapes for all plans. Later plans add schemas to it. They do not change these.

```ts
import { z } from "zod";

// Naming: each schema is `XSchema`, and its type is `X`. The schemas are `.readonly()`, so the
// inferred types are deeply readonly. Build new values; do not change parsed values.

declare const shaBrand: unique symbol;
/** A full 40-character commit or tree id. */
export type Sha = string & { readonly [shaBrand]: true };

const SHA = /^[0-9a-f]{40}$/u;

export function isSha(value: unknown): value is Sha {
    return typeof value === "string" && SHA.test(value);
}

export const ShaSchema = z.custom<Sha>(isSha, { message: "Expected a full 40-character sha" });

const RegexSchema = z.string().refine(
    value => {
        try {
            return new RegExp(value, "u").source.length > 0;
        } catch {
            return false;
        }
    },
    { message: "Not a valid regular expression" },
);

// ---- diff ----

export const FileStatusSchema = z.enum(["A", "M", "D", "R", "C", "T", "U"]);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const FileClassSchema = z.enum(["source", "test", "generated", "binary"]);
export type FileClass = z.infer<typeof FileClassSchema>;

export const ChangedFileSchema = z
    .strictObject({
        status: FileStatusSchema,
        path: z.string().min(1),
        oldPath: z.string().min(1),
        cls: FileClassSchema,
        untracked: z.boolean(),
    })
    .readonly();
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const DiffLineSchema = z.strictObject({ n: z.int().nonnegative(), text: z.string() }).readonly();
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const HunkSchema = z
    .strictObject({
        start: z.int().positive(),
        end: z.int().positive(),
        oldStart: z.int().nonnegative(),
        oldCount: z.int().nonnegative(),
        newStart: z.int().nonnegative(),
        newCount: z.int().nonnegative(),
        removed: z.array(DiffLineSchema).readonly(),
        added: z.array(DiffLineSchema).readonly(),
        size: z.int().nonnegative(),
    })
    .readonly();
export type Hunk = z.infer<typeof HunkSchema>;

// ---- config file (~/.diff-digest/config.json) ----

const GithubBackendConfigSchema = z.strictObject({ type: z.literal("github") });

const LocalBackendConfigSchema = z.strictObject({
    type: z.literal("local"),
    dir: z.string().min(1),
    linkTemplate: z.string().optional(),
    frontmatter: z.record(z.string(), z.unknown()).readonly().optional(),
});

export const BackendConfigSchema = z
    .discriminatedUnion("type", [GithubBackendConfigSchema, LocalBackendConfigSchema])
    .readonly();
export type BackendConfig = z.infer<typeof BackendConfigSchema>;

export const RepoConfigSchema = z
    .strictObject({
        generated: z.array(RegexSchema).readonly().optional(),
        publishTo: z.array(z.string().min(1)).readonly().optional(),
    })
    .readonly();
export type RepoConfig = z.infer<typeof RepoConfigSchema>;

/** The config file as it is on disk. Every key is optional; `resolveConfig` fills in the defaults. */
export const ConfigFileSchema = z
    .strictObject({
        backends: z.record(z.string().min(1), BackendConfigSchema).readonly().optional(),
        publishTo: z.array(z.string().min(1)).readonly().optional(),
        generated: z.array(RegexSchema).readonly().optional(),
        repos: z.record(z.string().min(1), RepoConfigSchema).readonly().optional(),
    })
    .readonly();
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

// ---- digest frontmatter (tool-owned) ----

export const FrontmatterSchema = z
    .strictObject({
        id: z.string().regex(/^[0-9a-z]{8}$/u),
        branch: z.string(),
        base: ShaSchema,
        /** null: the head is the working tree. */
        head: ShaSchema.nullable(),
        pinned: z.boolean(),
        meta: z.record(z.string(), z.unknown()).readonly(),
    })
    .readonly();
export type Frontmatter = z.infer<typeof FrontmatterSchema>;

// ---- comments (<name>.comments.json) ----

const DigestTargetSchema = z.strictObject({
    kind: z.literal("digest"),
    cid: z.string().min(1),
    section: z.string(),
    text: z.string(),
});

const CodeTargetSchema = z
    .strictObject({
        kind: z.literal("code"),
        path: z.string().min(1),
        rev: z.enum(["base", "head"]),
        line: z.int().positive(),
        endLine: z.int().positive().optional(),
        text: z.string(),
    })
    .refine(t => t.endLine === undefined || t.endLine >= t.line, { message: "endLine must not be before line" });

export const CommentTargetSchema = z.discriminatedUnion("kind", [DigestTargetSchema, CodeTargetSchema]).readonly();
export type CommentTarget = z.infer<typeof CommentTargetSchema>;

export const CommentSchema = z
    .strictObject({
        id: z.string().min(1),
        created: z.iso.datetime(),
        author: z.enum(["user", "agent"]),
        status: z.enum(["open", "resolved", "note", "shared"]),
        target: CommentTargetSchema,
        body: z.string().min(1),
        reply: z.string().optional(),
        /** Where a shared comment was posted (for example a PR comment URL). */
        ref: z.string().optional(),
    })
    .readonly();
export type Comment = z.infer<typeof CommentSchema>;

export const CommentsFileSchema = z.array(CommentSchema).readonly();
```

- [ ] **Step 3: Create `src/lib/paths.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

/** The tool's home folder. `DIFF_DIGEST_HOME` moves it, for example for tests. */
export function homeDir(): string {
    return process.env["DIFF_DIGEST_HOME"] ?? join(homedir(), ".diff-digest");
}

export function configPath(home: string = homeDir()): string {
    return join(home, "config.json");
}

export function storeDir(home: string = homeDir()): string {
    return join(home, "store");
}

export function expandHome(path: string): string {
    return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}
```

- [ ] **Step 4: Create the test helper `test/helpers/repo.ts`**

```ts
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect } from "bun:test";
import { DigestError, type ErrorCode } from "../../src/lib/errors";
import { git, rev } from "../../src/lib/repo";
import type { Sha } from "../../src/lib/schemas";

export interface TestRepo {
    readonly root: string;
    readonly write: (path: string, content: string | readonly number[]) => void;
    readonly commit: (message: string) => Sha;
    readonly remove: () => void;
}

export function tempDir(prefix: string): string {
    // realpath: on macOS the temp folder is a symlink, and git prints the real path.
    return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A new git repo on branch `main`, with no commits. */
export function makeRepo(): TestRepo {
    const root = tempDir("dd-repo-");
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    return {
        root,
        write: (path, content) => {
            const full = join(root, path);
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, typeof content === "string" ? content : new Uint8Array(content));
        },
        commit: message => {
            git(root, ["add", "-A"]);
            git(root, ["commit", "-q", "-m", message]);
            return rev(root, "HEAD");
        },
        remove: () => {
            rmSync(root, { recursive: true, force: true });
        },
    };
}

export function expectDigestError(run: () => unknown, code: ErrorCode): DigestError {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(DigestError);
        if (error instanceof DigestError) {
            expect(error.code).toBe(code);
            return error;
        }
    }
    throw new Error(`Expected a DigestError with code ${code}, but nothing was thrown.`);
}
```

- [ ] **Step 5: Write the failing test**

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { EMPTY_TREE, git, repoKeys, resolveBase, slug, tryRev } from "../../src/lib/repo";
import { expectDigestError, makeRepo, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
afterEach(() => repo?.remove());

describe("repo", () => {
    test("a repo with no commits has the empty tree as its base", () => {
        repo = makeRepo();
        expect(tryRev(repo.root, "HEAD")).toBeNull();
        expect(resolveBase(repo.root)).toBe(EMPTY_TREE);
    });

    test("the base is the merge-base with main", () => {
        repo = makeRepo();
        repo.write("a.txt", "a\n");
        const first = repo.commit("first");
        git(repo.root, ["checkout", "-q", "-b", "zf/topic"]);
        repo.write("a.txt", "b\n");
        repo.commit("second");
        expect(resolveBase(repo.root)).toBe(first);
    });

    test("an explicit base that is not a commit is NOT_FOUND", () => {
        repo = makeRepo();
        const { root } = repo;
        expectDigestError(() => resolveBase(root, "no-such-ref"), "NOT_FOUND");
    });

    test("repo keys come from origin when it exists", () => {
        repo = makeRepo();
        expect(repoKeys(repo.root)).toEqual([repo.root.split("/").at(-1) ?? ""]);
        git(repo.root, ["remote", "add", "origin", "git@github.com:octo/widgets.git"]);
        expect(repoKeys(repo.root)).toEqual(["widgets", "github.com/octo/widgets"]);
    });

    test("slug replaces characters that are not safe in a file name", () => {
        expect(slug("zf/foo bar")).toBe("zf-foo-bar");
    });
});
```

- [ ] **Step 6: Run the test to make sure that it fails**

Run: `bun test test/lib/repo.test.ts`
Expected: FAIL. The module `../../src/lib/repo` is not found.

- [ ] **Step 7: Create `src/lib/repo.ts`**

```ts
import { basename } from "node:path";
import { DigestError } from "./errors";
import { ShaSchema, type Sha } from "./schemas";

/** git's empty tree. It is the base in a repo that has no commits yet. */
export const EMPTY_TREE: Sha = ShaSchema.parse("4b825dc642cb6eb9a060e54bf8d69288fbee4904");

/** "worktree" means the working tree, including untracked files. */
export type Head = "worktree" | Sha;

export interface RepoContext {
    readonly root: string;
    readonly base: Sha;
    readonly head: Head;
}

export interface GitResult {
    readonly ok: boolean;
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

export interface OriginRepo {
    readonly host: string;
    readonly owner: string;
    readonly repo: string;
}

/** Runs git and returns the result. It never throws for a non-zero exit. */
export function runGit(root: string, args: readonly string[], input?: string): GitResult {
    const result = Bun.spawnSync(["git", ...args], {
        cwd: root,
        stdin: input === undefined ? "ignore" : Buffer.from(input),
        stdout: "pipe",
        stderr: "pipe",
    });
    return {
        ok: result.exitCode === 0,
        code: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
    };
}

/** Runs git and returns stdout. Throws GIT_FAILED for a non-zero exit. */
export function git(root: string, args: readonly string[], input?: string): string {
    const result = runGit(root, args, input);
    if (!result.ok) {
        throw new DigestError("GIT_FAILED", `git ${args.join(" ")} failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
}

export function findRepoRoot(cwd: string): string {
    const result = runGit(cwd, ["rev-parse", "--show-toplevel"]);
    if (!result.ok) throw new DigestError("NOT_FOUND", `${cwd} is not in a git repo.`);
    return result.stdout.trim();
}

export function tryRev(root: string, ref: string): Sha | null {
    if (ref === EMPTY_TREE) return EMPTY_TREE;
    if (ref === "") return null;
    const result = runGit(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return result.ok ? ShaSchema.parse(result.stdout.trim()) : null;
}

export function rev(root: string, ref: string): Sha {
    const sha = tryRev(root, ref);
    if (sha === null) throw new DigestError("NOT_FOUND", `Not a commit: ${ref}`);
    return sha;
}

export function hasCommit(root: string, sha: string): boolean {
    return sha !== "" && runGit(root, ["cat-file", "-e", `${sha}^{commit}`]).ok;
}

export function mergeBase(root: string, a: string, b: string): Sha {
    return ShaSchema.parse(git(root, ["merge-base", a, b]).trim());
}

/** The current branch name, or "" when HEAD is detached. */
export function currentBranch(root: string): string {
    return git(root, ["branch", "--show-current"]).trim();
}

/** The merge-base with the remote default branch, or the empty tree in a repo with no commits. */
export function resolveBase(root: string, ref?: string, head = "HEAD"): Sha {
    if (ref !== undefined) return rev(root, ref);
    if (head === "HEAD" && tryRev(root, "HEAD") === null) return EMPTY_TREE;
    for (const branch of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
        const result = runGit(root, ["merge-base", head, branch]);
        if (result.ok) return ShaSchema.parse(result.stdout.trim());
    }
    throw new DigestError("NOT_FOUND", "No base found.", { hint: "Give a base ref." });
}

const ORIGIN = /^(?:ssh:\/\/)?(?:git@|https?:\/\/)([^:/]+)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/u;

export function originRepo(root: string): OriginRepo | null {
    const result = runGit(root, ["remote", "get-url", "origin"]);
    if (!result.ok) return null;
    const match = ORIGIN.exec(result.stdout.trim());
    if (match === null) return null;
    const [, host, owner, repo] = match;
    if (host === undefined || owner === undefined || repo === undefined) return null;
    return { host, owner, repo };
}

/** The keys that a repo entry in the config can use: the repo name, then host/owner/name. */
export function repoKeys(root: string): readonly [string, ...string[]] {
    const origin = originRepo(root);
    if (origin === null) return [basename(root)];
    return [origin.repo, `${origin.host}/${origin.owner}/${origin.repo}`];
}

export function short(sha: string): string {
    return sha.slice(0, 11);
}

export function slug(value: string): string {
    return value.replaceAll(/[^\w.-]+/gu, "-");
}
```

- [ ] **Step 8: Run the test to make sure that it passes**

Run: `bun test test/lib/repo.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 9: Run the full check**

Run: `bun run verify`
Expected: all steps pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/errors.ts src/lib/schemas.ts src/lib/paths.ts src/lib/repo.ts test/helpers/repo.ts test/lib/repo.test.ts
git commit -m "minor: add lib errors, schemas, paths, and git layer"
```

### Task 3: Pure digest helpers and frontmatter

**Files:**
- Create: `src/lib/digest.ts`
- Create: `src/lib/frontmatter.ts`
- Test: `test/lib/digest.test.ts`
- Test: `test/lib/frontmatter.test.ts`

**Interfaces:**
- Consumes: `ChangedFile`, `Frontmatter`, `FrontmatterSchema`, `ShaSchema` (Task 2), `DigestError` (Task 2), `expectDigestError` (Task 2).
- Produces (`digest.ts`): `interface Anchor { path; start; end }`, `ANCHOR` (global regex), `anchors(md) → Anchor[]`, `matchesPath(file, suffix) → boolean`, `findFile(files, suffix) → ChangedFile | undefined`, `blockId(section, text) → string`.
- Produces (`frontmatter.ts`): `interface ParsedDigest { frontmatter: Frontmatter; body: string }`, `parseDigest(md) → ParsedDigest` (throws `BAD_INPUT`), `serializeDigest(frontmatter, body) → string`.

- [ ] **Step 1: Write the failing tests**

`test/lib/digest.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { anchors, blockId, findFile } from "../../src/lib/digest";
import type { ChangedFile } from "../../src/lib/schemas";

describe("digest helpers", () => {
    test("anchors reads single lines and ranges", () => {
        expect(anchors("see `src/a.ts:10` and `b.tsx:3-7`, not `plain`")).toEqual([
            { path: "src/a.ts", start: 10, end: 10 },
            { path: "b.tsx", start: 3, end: 7 },
        ]);
    });

    test("blockId is stable and depends on the section", () => {
        expect(blockId("Changes", "a")).toBe(blockId("Changes", "a"));
        expect(blockId("Changes", "a")).not.toBe(blockId("Tests", "a"));
    });

    test("findFile matches a path suffix at a folder edge, or the old path", () => {
        const files: ChangedFile[] = [
            { status: "R", oldPath: "old/x.ts", path: "src/lib/x.ts", cls: "source", untracked: false },
        ];
        expect(findFile(files, "lib/x.ts")?.path).toBe("src/lib/x.ts");
        expect(findFile(files, "old/x.ts")?.path).toBe("src/lib/x.ts");
        expect(findFile(files, "b/x.ts")).toBeUndefined();
    });
});
```

`test/lib/frontmatter.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseDigest, serializeDigest } from "../../src/lib/frontmatter";
import { ShaSchema, type Frontmatter } from "../../src/lib/schemas";
import { expectDigestError } from "../helpers/repo";

const FM: Frontmatter = {
    id: "k3f9a0b2",
    branch: "zf/foo",
    base: ShaSchema.parse("a".repeat(40)),
    head: null,
    pinned: false,
    meta: { pr: "https://github.com/o/r/pull/1" },
};

describe("frontmatter", () => {
    test("round trips", () => {
        const md = serializeDigest(FM, "# Title\n");
        expect(md.startsWith("---\n")).toBe(true);
        expect(parseDigest(md)).toEqual({ frontmatter: FM, body: "\n# Title\n" });
    });

    test("a digest with no frontmatter is BAD_INPUT", () => {
        expectDigestError(() => parseDigest("# Title\n"), "BAD_INPUT");
    });

    test("frontmatter with an unknown key is BAD_INPUT", () => {
        const md = serializeDigest(FM, "x").replace("pinned: false", "pinned: false\npr: x");
        expectDigestError(() => parseDigest(md), "BAD_INPUT");
    });
});
```

- [ ] **Step 2: Run the tests to make sure that they fail**

Run: `bun test test/lib/digest.test.ts test/lib/frontmatter.test.ts`
Expected: FAIL. The modules are not found.

- [ ] **Step 3: Create `src/lib/digest.ts`**

This file must not import Node or Bun APIs, because the UI imports it.

```ts
// Pure helpers. The UI imports this file, so it must not import Node or Bun APIs.
import type { ChangedFile } from "./schemas";

export interface Anchor {
    readonly path: string;
    readonly start: number;
    readonly end: number;
}

/** An anchor is a code span `path:line` or `path:start-end`. */
export const ANCHOR = /`([\w@#./-]+\.\w+):(\d+)(?:-(\d+))?`/gu;

export function anchors(md: string): Anchor[] {
    const out: Anchor[] = [];
    for (const match of md.matchAll(ANCHOR)) {
        const [, path, start, end] = match;
        if (path === undefined || start === undefined) continue;
        out.push({ path, start: Number(start), end: Number(end ?? start) });
    }
    return out;
}

/** True when `suffix` is the full path or a path suffix that starts at a folder edge. */
export function matchesPath(file: string, suffix: string): boolean {
    return file === suffix || file.endsWith(`/${suffix}`);
}

export function findFile(files: readonly ChangedFile[], suffix: string): ChangedFile | undefined {
    if (suffix === "") return undefined;
    return files.find(f => matchesPath(f.path, suffix) || matchesPath(f.oldPath, suffix));
}

/** A stable id for a digest block (djb2 hash, base 36). The UI, the linter, and comments use it. */
export function blockId(section: string, text: string): string {
    const input = `${section}|${text}`;
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) + hash + (input.codePointAt(i) ?? 0)) >>> 0;
    }
    return (hash >>> 0).toString(36);
}
```

- [ ] **Step 4: Create `src/lib/frontmatter.ts`**

`Bun.YAML` parses and writes the YAML. The schema rejects unknown keys, so an old digest with `pr:` in its frontmatter gives `BAD_INPUT`.

```ts
import { z } from "zod";
import { DigestError } from "./errors";
import { FrontmatterSchema, type Frontmatter } from "./schemas";

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/u;

export interface ParsedDigest {
    readonly frontmatter: Frontmatter;
    readonly body: string;
}

/** Splits a digest into frontmatter and body, and validates the frontmatter. */
export function parseDigest(md: string): ParsedDigest {
    const match = FRONTMATTER.exec(md);
    const raw = match?.[1];
    if (match === null || raw === undefined) {
        throw new DigestError("BAD_INPUT", "The digest has no frontmatter.", {
            hint: "Create it with `diff-digest init`.",
        });
    }
    const result = FrontmatterSchema.safeParse(Bun.YAML.parse(raw));
    if (!result.success) {
        throw new DigestError("BAD_INPUT", `The digest frontmatter is not valid:\n${z.prettifyError(result.error)}`);
    }
    return { frontmatter: result.data, body: md.slice(match[0].length) };
}

export function serializeDigest(frontmatter: Readonly<Frontmatter>, body: string): string {
    const yaml = Bun.YAML.stringify(FrontmatterSchema.parse(frontmatter), null, 2).trimEnd();
    return `---\n${yaml}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
}
```

- [ ] **Step 5: Run the tests to make sure that they pass**

Run: `bun test test/lib/digest.test.ts test/lib/frontmatter.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 6: Run the full check**

Run: `bun run verify`
Expected: all steps pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/digest.ts src/lib/frontmatter.ts test/lib/digest.test.ts test/lib/frontmatter.test.ts
git commit -m "minor: add digest helpers and YAML frontmatter"
```

### Task 4: Changed files, classes, and hunks

**Files:**
- Create: `src/lib/diff.ts`
- Test: `test/lib/diff.test.ts`

**Interfaces:**
- Consumes: `RepoContext`, `git`, `runGit`, `rev`, `EMPTY_TREE` (Task 2), `ChangedFileSchema`, `FileStatusSchema`, `ChangedFile`, `DiffLine`, `FileClass`, `Hunk` (Task 2), `makeRepo` (Task 2).
- Produces: `BUILTIN_GENERATED: readonly RegExp[]`, `isBuiltinGenerated(path) → boolean`, `newText(ctx, path)`, `newExists(ctx, path)`, `isBinaryFile(fullPath)`, `changedFiles(ctx, isGenerated: (path: string) => boolean) → ChangedFile[]`, `parseDiff(text) → Hunk[]`, `rawDiff(ctx, file, context = 0) → string`, `importLines(text) → Set<number>`, `reviewableHunks(ctx, file) → Hunk[]`, `isReviewable(file)`, `diffLineCount(ctx, files)`.
- Behavior: the same as `changedFiles`, `parseDiff`, `rawDiff`, `reviewableHunks`, `importLines`, and `diffLineCount` in `bin/diff-digest.mjs`, with untracked files in working-tree mode. `changedFiles` takes the config test as a predicate (from `generatedMatcher` in Task 6). It does not read the config.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { changedFiles, parseDiff, rawDiff, reviewableHunks } from "../../src/lib/diff";
import { EMPTY_TREE, rev, type RepoContext } from "../../src/lib/repo";
import type { ChangedFile } from "../../src/lib/schemas";
import { makeRepo, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
afterEach(() => repo?.remove());

function worktree(r: TestRepo, base = rev(r.root, "HEAD")): RepoContext {
    return { root: r.root, base, head: "worktree" };
}

function byPath(files: readonly ChangedFile[], path: string): ChangedFile {
    const file = files.find(f => f.path === path);
    if (file === undefined) throw new Error(`${path} is not in the changed files`);
    return file;
}

describe("parseDiff", () => {
    test("reads hunk ranges and line numbers", () => {
        const text = ["@@ -1,2 +1,3 @@", " a", "-b", "+B", "+c"].join("\n");
        const [hunk] = parseDiff(text);
        expect(hunk).toMatchObject({ start: 1, end: 3, oldStart: 1, oldCount: 2, newStart: 1, newCount: 3, size: 3 });
        expect(hunk?.removed).toEqual([{ n: 2, text: "b" }]);
        expect(hunk?.added).toEqual([
            { n: 2, text: "B" },
            { n: 3, text: "c" },
        ]);
    });
});

describe("changedFiles", () => {
    test("includes uncommitted edits and untracked files", () => {
        repo = makeRepo();
        repo.write("a.ts", "export const a = 1;\n");
        repo.commit("init");
        repo.write("a.ts", "export const a = 2;\n");
        repo.write("new.ts", "export const n = 1;\n");
        const ctx = worktree(repo);
        const files = changedFiles(ctx, () => false);
        expect(byPath(files, "a.ts")).toMatchObject({ status: "M", cls: "source", untracked: false });
        const added = byPath(files, "new.ts");
        expect(added).toMatchObject({ status: "A", cls: "source", untracked: true });
        expect(rawDiff(ctx, added)).toContain("+export const n = 1;");
    });

    test("does not list files that .gitignore excludes", () => {
        repo = makeRepo();
        repo.write(".gitignore", "dist/\n");
        repo.commit("init");
        repo.write("dist/out.js", "x\n");
        expect(changedFiles(worktree(repo), () => false)).toEqual([]);
    });

    test("works in a repo with no commits", () => {
        repo = makeRepo();
        repo.write("x.ts", "x\n");
        const files = changedFiles({ root: repo.root, base: EMPTY_TREE, head: "worktree" }, () => false);
        expect(files.map(f => f.path)).toEqual(["x.ts"]);
    });

    test("sorts files into classes", () => {
        repo = makeRepo();
        repo.write(".gitattributes", "gen/** linguist-generated\n");
        repo.commit("init");
        repo.write("pnpm-lock.yaml", "lock\n");
        repo.write("gen/api.ts", "x\n");
        repo.write("src/a.test.ts", "x\n");
        repo.write("src/BUILD.bazel", "x\n");
        repo.write("img.bin", [1, 0, 2]);
        const files = changedFiles(worktree(repo), path => path.endsWith("BUILD.bazel"));
        expect(byPath(files, "pnpm-lock.yaml").cls).toBe("generated");
        expect(byPath(files, "gen/api.ts").cls).toBe("generated");
        expect(byPath(files, "src/a.test.ts").cls).toBe("test");
        expect(byPath(files, "src/BUILD.bazel").cls).toBe("generated");
        expect(byPath(files, "img.bin").cls).toBe("binary");
    });

    test("a pinned head ignores the working tree", () => {
        repo = makeRepo();
        repo.write("a.ts", "1\n");
        const base = repo.commit("init");
        repo.write("a.ts", "2\n");
        const head = repo.commit("change");
        repo.write("a.ts", "3\n");
        repo.write("untracked.ts", "x\n");
        const files = changedFiles({ root: repo.root, base, head }, () => false);
        expect(files.map(f => f.path)).toEqual(["a.ts"]);
        expect(rawDiff({ root: repo.root, base, head }, byPath(files, "a.ts"))).toContain("+2");
    });
});

describe("reviewableHunks", () => {
    test("drops a hunk that only changes imports", () => {
        repo = makeRepo();
        repo.write("a.ts", 'import { x } from "./x";\n\nexport const a = x;\n');
        repo.commit("init");
        repo.write("a.ts", 'import { x, y } from "./x";\n\nexport const a = x;\n');
        const ctx = worktree(repo);
        const [file] = changedFiles(ctx, () => false);
        if (file === undefined) throw new Error("no changed file");
        expect(reviewableHunks(ctx, file)).toEqual([]);
    });

    test("drops hunks whose lines only moved", () => {
        repo = makeRepo();
        repo.write("a.ts", "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
        repo.commit("init");
        repo.write("a.ts", "export const b = 2;\nexport const c = 3;\nexport const a = 1;\n");
        const ctx = worktree(repo);
        const [file] = changedFiles(ctx, () => false);
        if (file === undefined) throw new Error("no changed file");
        expect(reviewableHunks(ctx, file)).toEqual([]);
    });

    test("keeps a hunk that changes behavior", () => {
        repo = makeRepo();
        repo.write("a.ts", "export const a = 1;\n");
        repo.commit("init");
        repo.write("a.ts", "export const a = 2;\n");
        const ctx = worktree(repo);
        const [file] = changedFiles(ctx, () => false);
        if (file === undefined) throw new Error("no changed file");
        expect(reviewableHunks(ctx, file).map(h => [h.start, h.end])).toEqual([[1, 1]]);
    });
});
```

- [ ] **Step 2: Run the test to make sure that it fails**

Run: `bun test test/lib/diff.test.ts`
Expected: FAIL. The module `../../src/lib/diff` is not found.

- [ ] **Step 3: Create `src/lib/diff.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    ChangedFileSchema,
    FileStatusSchema,
    type ChangedFile,
    type DiffLine,
    type FileClass,
    type Hunk,
} from "./schemas";
import { git, runGit, type RepoContext } from "./repo";

export const BUILTIN_GENERATED: readonly RegExp[] = [
    /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|go\.sum|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|flake\.lock)$/u,
    /\.snap$/u,
    /(^|\/)__generated__\//u,
    /\.pb\.(ts|go)$|_pb2\.py$/u,
    /\.min\.(js|css)$|\.map$/u,
];

/** True when a built-in pattern marks the path as generated. */
export function isBuiltinGenerated(path: string): boolean {
    for (const pattern of BUILTIN_GENERATED) if (pattern.test(path)) return true;
    return false;
}

const TEST = /(\.(test|spec)\.[cm]?[jt]sx?$)|(\/__tests__\/)|(_test\.(go|py)$)|((^|\/)test_[^/]+\.py$)/u;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

function rangeArgs(ctx: RepoContext): string[] {
    return ctx.head === "worktree" ? [ctx.base] : [ctx.base, ctx.head];
}

/** The file text after the change. */
export function newText(ctx: RepoContext, path: string): string {
    return ctx.head === "worktree"
        ? readFileSync(join(ctx.root, path), "utf8")
        : git(ctx.root, ["show", `${ctx.head}:${path}`]);
}

export function newExists(ctx: RepoContext, path: string): boolean {
    if (ctx.head === "worktree") return existsSync(join(ctx.root, path));
    return runGit(ctx.root, ["cat-file", "-e", `${ctx.head}:${path}`]).ok;
}

/** git's test for a binary file: a NUL byte in the first 8000 bytes. */
export function isBinaryFile(fullPath: string): boolean {
    return readFileSync(fullPath).subarray(0, 8000).includes(0);
}

/**
 * The files that changed between the base and the head, with a class for each file.
 * For the working tree, untracked files that .gitignore does not exclude count as added.
 */
export function changedFiles(ctx: RepoContext, isGenerated: (path: string) => boolean): ChangedFile[] {
    const range = rangeArgs(ctx);
    const entries: Omit<ChangedFile, "cls">[] = [];
    for (const line of git(ctx.root, ["diff", "--no-ext-diff", "--name-status", "-M", ...range]).split("\n")) {
        const [status, a, b] = line.split("\t");
        if (status === undefined || a === undefined || status === "") continue;
        entries.push({ status: FileStatusSchema.parse(status.charAt(0)), oldPath: a, path: b ?? a, untracked: false });
    }
    if (ctx.head === "worktree") {
        for (const path of git(ctx.root, ["ls-files", "-z", "--others", "--exclude-standard"]).split("\0")) {
            if (path !== "") entries.push({ status: "A", oldPath: path, path, untracked: true });
        }
    }
    const binary = binaryPaths(ctx, range);
    for (const e of entries) if (e.untracked && isBinaryFile(join(ctx.root, e.path))) binary.add(e.path);
    const attrs = checkAttrs(
        ctx,
        entries.map(e => e.path),
    );
    return entries.map(e =>
        ChangedFileSchema.parse({
            ...e,
            cls: classify(e.path, attrs.get(e.path) ?? {}, binary.has(e.path), isGenerated),
        }),
    );
}

function isAttrSet(value: string | undefined): boolean {
    return value === "set" || value === "true";
}

function classify(
    path: string,
    attrs: Readonly<Record<string, string>>,
    binary: boolean,
    isGenerated: (path: string) => boolean,
): FileClass {
    // linguist-generated=false only changes GitHub's diff view, so it does not make a file reviewable.
    if (isAttrSet(attrs["linguist-generated"]) || isAttrSet(attrs["linguist-vendored"])) return "generated";
    if (attrs["filter"] === "lfs" || binary) return "binary";
    if (isBuiltinGenerated(path) || isGenerated(path)) return "generated";
    return TEST.test(path) ? "test" : "source";
}

function binaryPaths(ctx: RepoContext, range: readonly string[]): Set<string> {
    const tokens = git(ctx.root, ["diff", "--no-ext-diff", "--numstat", "-z", "-M", ...range]).split("\0");
    const out = new Set<string>();
    for (let i = 0; i < tokens.length; i += 1) {
        const match = /^(\S+)\t(\S+)\t(.*)$/u.exec(tokens[i] ?? "");
        if (match === null) continue;
        const [, added, , inline] = match;
        // A rename has an empty path field, then the old path and the new path as two more tokens.
        const path = inline === undefined || inline === "" ? tokens[i + 2] : inline;
        if (inline === undefined || inline === "") i += 2;
        if (added === "-" && path !== undefined) out.add(path);
    }
    return out;
}

function checkAttrs(ctx: RepoContext, paths: readonly string[]): Map<string, Record<string, string>> {
    const attrs = new Map<string, Record<string, string>>();
    if (paths.length === 0) return attrs;
    const source = ctx.head === "worktree" ? [] : [`--source=${ctx.head}`];
    const out = git(
        ctx.root,
        ["check-attr", "-z", "--stdin", ...source, "linguist-generated", "linguist-vendored", "filter"],
        `${paths.join("\0")}\0`,
    ).split("\0");
    for (let i = 0; i + 2 < out.length; i += 3) {
        const [path, name, value] = [out[i], out[i + 1], out[i + 2]];
        if (path === undefined || name === undefined || value === undefined) continue;
        attrs.set(path, { ...attrs.get(path), [name]: value });
    }
    return attrs;
}

interface HunkBuilder {
    readonly header: Omit<Hunk, "removed" | "added" | "size">;
    readonly removed: DiffLine[];
    readonly added: DiffLine[];
}

export function parseDiff(text: string): Hunk[] {
    const builders: HunkBuilder[] = [];
    let current: HunkBuilder | null = null;
    let oldN = 0;
    let newN = 0;
    for (const line of text.split("\n")) {
        const match = HUNK_HEADER.exec(line);
        if (match !== null) {
            const [, oldStart = "0", oldCount, newStart = "0", newCount] = match;
            oldN = Number(oldStart);
            newN = Number(newStart);
            const count = newCount === undefined ? 1 : Number(newCount);
            current = {
                header: {
                    start: Math.max(newN, 1),
                    end: Math.max(newN + count - 1, newN, 1),
                    oldStart: oldN,
                    oldCount: oldCount === undefined ? 1 : Number(oldCount),
                    newStart: newN,
                    newCount: count,
                },
                removed: [],
                added: [],
            };
            builders.push(current);
        } else if (current === null || /^(\+\+\+|---) /u.test(line)) {
            continue;
        } else if (line.startsWith("-")) {
            current.removed.push({ n: oldN, text: line.slice(1) });
            oldN += 1;
        } else if (line.startsWith("+")) {
            current.added.push({ n: newN, text: line.slice(1) });
            newN += 1;
        } else if (line.startsWith(" ")) {
            oldN += 1;
            newN += 1;
        }
    }
    const hunks: Hunk[] = [];
    for (const b of builders) {
        hunks.push({ ...b.header, removed: b.removed, added: b.added, size: b.removed.length + b.added.length });
    }
    return hunks;
}

export function rawDiff(ctx: RepoContext, file: Readonly<ChangedFile>, context = 0): string {
    if (file.untracked) {
        // --no-index exits with 1 when the files differ, so a non-zero exit is not an error here.
        return runGit(ctx.root, ["diff", "--no-ext-diff", "--no-index", `-U${context}`, "--", "/dev/null", file.path])
            .stdout;
    }
    const paths = file.oldPath === file.path ? [file.path] : [file.oldPath, file.path];
    return git(ctx.root, ["diff", "--no-ext-diff", `-U${context}`, "-M", ...rangeArgs(ctx), "--", ...paths]);
}

/** The line numbers (1-based) that are part of an import or a re-export statement. */
export function importLines(text: string): Set<number> {
    const lines = new Set<number>();
    let inImport = false;
    for (const [i, line] of text.split("\n").entries()) {
        if (/^\s*import\b/u.test(line) || /^\s*export\s+(\*|\{[^}]*\})\s+from\b/u.test(line)) inImport = true;
        if (inImport) lines.add(i + 1);
        if (inImport && /(from\s+["'][^"']+["']|^\s*import\s+["'][^"']+["'])\s*;?\s*$/u.test(line)) inImport = false;
    }
    return lines;
}

function blank(text: string): boolean {
    return text.trim() === "";
}

/** The hunks to review: drops hunks that only touch imports and hunks whose lines all moved. */
export function reviewableHunks(ctx: RepoContext, file: Readonly<ChangedFile>): Hunk[] {
    const hunks = parseDiff(rawDiff(ctx, file));
    const oldImports =
        file.status === "A" ? new Set<number>() : importLines(git(ctx.root, ["show", `${ctx.base}:${file.oldPath}`]));
    const newImports = file.status === "D" ? new Set<number>() : importLines(newText(ctx, file.path));
    const allRemoved = new Set(hunks.flatMap(h => h.removed.map(l => l.text.trim())));
    const allAdded = new Set(hunks.flatMap(h => h.added.map(l => l.text.trim())));
    return hunks.filter(h => {
        const importOnly =
            h.removed.every(l => oldImports.has(l.n) || blank(l.text)) &&
            h.added.every(l => newImports.has(l.n) || blank(l.text));
        const moved =
            h.added.every(l => blank(l.text) || allRemoved.has(l.text.trim())) &&
            h.removed.every(l => blank(l.text) || allAdded.has(l.text.trim()));
        return !importOnly && !moved;
    });
}

export function isReviewable(file: Readonly<ChangedFile>): boolean {
    return file.cls === "source" || file.cls === "test";
}

export function diffLineCount(ctx: RepoContext, files: readonly ChangedFile[]): number {
    return files
        .filter(f => isReviewable(f))
        .reduce((n, f) => n + parseDiff(rawDiff(ctx, f)).reduce((s, h) => s + h.size, 0), 0);
}
```

- [ ] **Step 4: Run the test to make sure that it passes**

Run: `bun test test/lib/diff.test.ts`
Expected: 9 pass, 0 fail.

- [ ] **Step 5: Run the full check**

Run: `bun run verify`
Expected: all steps pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/diff.ts test/lib/diff.test.ts
git commit -m "minor: add changed-file, class, and hunk analysis"
```

### Task 5: Anchor coverage

**Files:**
- Create: `src/lib/coverage.ts`
- Test: `test/lib/coverage.test.ts`

**Interfaces:**
- Consumes: `anchors`, `matchesPath` (Task 3), `isReviewable`, `reviewableHunks`, `changedFiles` (Task 4).
- Produces: `coverageGaps(ctx, md, files: readonly ChangedFile[]) → string[]`. Each entry is `path:start-end` or `path (deleted)`. An anchor covers a hunk when its range overlaps the hunk or touches it (one line of tolerance on each side).

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { coverageGaps } from "../../src/lib/coverage";
import { changedFiles } from "../../src/lib/diff";
import { rev, type RepoContext } from "../../src/lib/repo";
import { makeRepo, type TestRepo } from "../helpers/repo";

let repo: TestRepo | undefined;
afterEach(() => repo?.remove());

function setup(): RepoContext {
    repo = makeRepo();
    repo.write("src/a.ts", "export const a = 1;\nexport const b = 2;\n");
    repo.write("src/gone.ts", "x\n");
    repo.commit("init");
    repo.write("src/a.ts", "export const a = 1;\nexport const b = 3;\n");
    repo.write("src/gone.ts", "");
    return { root: repo.root, base: rev(repo.root, "HEAD"), head: "worktree" };
}

describe("coverageGaps", () => {
    test("reports a hunk that no anchor touches", () => {
        const ctx = setup();
        expect(
            coverageGaps(
                ctx,
                "# Title\n",
                changedFiles(ctx, () => false),
            ),
        ).toEqual(["src/a.ts:2-2", "src/gone.ts:1-1"]);
    });

    test("an anchor on a path suffix next to the hunk covers it", () => {
        const ctx = setup();
        const md = "- b changed: `a.ts:1`\n- gone emptied: `gone.ts:1`\n";
        expect(
            coverageGaps(
                ctx,
                md,
                changedFiles(ctx, () => false),
            ),
        ).toEqual([]);
    });

    test("a deleted file is a gap unless the digest names it", () => {
        repo = makeRepo();
        repo.write("src/old.ts", "x\n");
        repo.commit("init");
        rmSync(join(repo.root, "src/old.ts"));
        const ctx: RepoContext = { root: repo.root, base: rev(repo.root, "HEAD"), head: "worktree" };
        const files = changedFiles(ctx, () => false);
        expect(coverageGaps(ctx, "# Title\n", files)).toEqual(["src/old.ts (deleted)"]);
        expect(coverageGaps(ctx, "- removed `old.ts`\n", files)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the test to make sure that it fails**

Run: `bun test test/lib/coverage.test.ts`
Expected: FAIL. The module `../../src/lib/coverage` is not found.

- [ ] **Step 3: Create `src/lib/coverage.ts`**

```ts
import { anchors, matchesPath } from "./digest";
import { isReviewable, reviewableHunks } from "./diff";
import type { RepoContext } from "./repo";
import type { ChangedFile } from "./schemas";

/** The reviewable hunks that no anchor in the digest touches, as `path:start-end` or `path (deleted)`. */
export function coverageGaps(ctx: RepoContext, md: string, files: readonly ChangedFile[]): string[] {
    const all = anchors(md);
    const gaps: string[] = [];
    for (const file of files) {
        if (!isReviewable(file)) continue;
        const own = all.filter(a => matchesPath(file.path, a.path) || matchesPath(file.oldPath, a.path));
        if (file.status === "D") {
            const name = file.oldPath.split("/").at(-1) ?? file.oldPath;
            if (!md.includes(name)) gaps.push(`${file.oldPath} (deleted)`);
            continue;
        }
        for (const h of reviewableHunks(ctx, file)) {
            const covered = own.some(a => a.start <= h.end + 1 && a.end >= h.start - 1);
            if (!covered) gaps.push(`${file.path}:${h.start}-${h.end}`);
        }
    }
    return gaps;
}
```

- [ ] **Step 4: Run the test to make sure that it passes**

Run: `bun test test/lib/coverage.test.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Run the full check**

Run: `bun run verify`
Expected: all steps pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/coverage.ts test/lib/coverage.test.ts
git commit -m "minor: add anchor coverage check"
```

### Task 6: Store and config

**Files:**
- Create: `src/lib/store.ts`
- Create: `src/lib/config.ts`
- Test: `test/lib/store.test.ts`
- Test: `test/lib/config.test.ts`

**Interfaces:**
- Consumes: `storeDir`, `configPath` (Task 2), `CommentsFileSchema`, `Comment`, `ConfigFileSchema`, `ConfigFile`, `BackendConfigSchema`, `BackendConfig`, `RepoConfig` (Task 2), `DigestError` (Task 2).
- Produces (`store.ts`): `writeAtomic(path, data)`, `readJson(path) → unknown`, `workingCopyPath(repo, name, home?)`, `commentsPath(mdPath)`, `readComments(mdPath) → readonly Comment[]` (throws `BAD_INPUT`), `writeComments(mdPath, comments)`.
- Produces (`config.ts`): `interface ResolvedConfig { repoKeys; key; backends; publishTo; generated; repoGenerated }`, `readConfigFile(path?) → ConfigFile` (throws `BAD_CONFIG` for a file that is not JSON or does not match the schema), `resolveConfig(file, repoKeys) → ResolvedConfig` (throws `BAD_CONFIG` when `publishTo` names a missing backend), `generatedMatcher(config) → (path: string) => boolean`, `exactPattern(path)`, `setGenerated(path, on, repoKeys, file?)`.
- Defaults: with no `backends`, the only backend is `github: { type: "github" }`. With no `publishTo`, it is `["github"]`. `setGenerated` writes back only the keys that were in the file, plus the changed repo entry. It never writes the defaults.

- [ ] **Step 1: Write the failing tests**

`test/lib/store.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Comment } from "../../src/lib/schemas";
import { commentsPath, readComments, workingCopyPath, writeComments } from "../../src/lib/store";
import { expectDigestError, tempDir } from "../helpers/repo";

let dir: string | undefined;
afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

const TARGET = { kind: "code", path: "src/a.ts", rev: "head", line: 3, endLine: 5, text: "x" } as const;

const COMMENT: Comment = {
    id: "c1",
    created: "2026-09-30T12:00:00.000Z",
    author: "user",
    status: "open",
    target: TARGET,
    body: "Why?",
};

describe("store", () => {
    test("the working copy is under store/<repo>", () => {
        expect(workingCopyPath("lca", "zf-foo", "/h")).toBe("/h/store/lca/zf-foo.md");
        expect(commentsPath("/h/store/lca/zf-foo.md")).toBe("/h/store/lca/zf-foo.comments.json");
    });

    test("comments round trip, and the write leaves no temp file", () => {
        dir = tempDir("dd-store-");
        const md = join(dir, "d.md");
        expect(readComments(md)).toEqual([]);
        writeComments(md, [COMMENT]);
        expect(readComments(md)).toEqual([COMMENT]);
        expect(readdirSync(dir)).toEqual(["d.comments.json"]);
    });

    test("a comments file that does not match the schema is BAD_INPUT", () => {
        dir = tempDir("dd-store-");
        const md = join(dir, "d.md");
        writeFileSync(commentsPath(md), JSON.stringify([{ ...COMMENT, status: "posted" }]));
        expectDigestError(() => readComments(md), "BAD_INPUT");
    });

    test("a code range that ends before it starts is rejected", () => {
        dir = tempDir("dd-store-");
        const md = join(dir, "d.md");
        const bad: Comment = { ...COMMENT, target: { ...TARGET, line: 5, endLine: 3 } };
        expect(() => {
            writeComments(md, [bad]);
        }).toThrow();
    });
});
```

`test/lib/config.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exactPattern, readConfigFile, resolveConfig, setGenerated } from "../../src/lib/config";
import { expectDigestError, tempDir } from "../helpers/repo";

let dir: string | undefined;
afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

function configFile(content: unknown): string {
    dir = tempDir("dd-config-");
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify(content));
    return path;
}

describe("config", () => {
    test("a missing file is an empty config with the github default", () => {
        dir = tempDir("dd-config-");
        const resolved = resolveConfig(readConfigFile(join(dir, "none.json")), ["repo"]);
        expect(resolved.publishTo).toEqual(["github"]);
        expect(Object.keys(resolved.backends)).toEqual(["github"]);
        expect(resolved.generated).toEqual([]);
    });

    test("a file that is not JSON is BAD_CONFIG", () => {
        dir = tempDir("dd-config-");
        const path = join(dir, "config.json");
        writeFileSync(path, "{ not json");
        expectDigestError(() => readConfigFile(path), "BAD_CONFIG");
    });

    test("an unknown key is BAD_CONFIG", () => {
        const path = configFile({ digestDir: "~/x" });
        expectDigestError(() => readConfigFile(path), "BAD_CONFIG");
    });

    test("a bad regex is BAD_CONFIG", () => {
        const path = configFile({ generated: ["("] });
        expectDigestError(() => readConfigFile(path), "BAD_CONFIG");
    });

    test("publishTo must name a backend", () => {
        expectDigestError(() => resolveConfig({ publishTo: ["notes"] }, ["repo"]), "BAD_CONFIG");
    });

    test("the repo entry is matched by name or host/owner/name and adds to the global list", () => {
        const resolved = resolveConfig(
            { generated: ["a"], repos: { "github.com/o/r": { generated: ["b"], publishTo: [] } } },
            ["r", "github.com/o/r"],
        );
        expect(resolved.key).toBe("github.com/o/r");
        expect(resolved.generated).toEqual(["a", "b"]);
        expect(resolved.repoGenerated).toEqual(["b"]);
        expect(resolved.publishTo).toEqual([]);
    });

    test("setGenerated adds and removes one exact pattern and keeps other keys", () => {
        const path = configFile({ generated: ["g"], repos: { r: { publishTo: ["github"] } } });
        setGenerated("src/a.b.ts", true, ["r"], path);
        expect(readConfigFile(path).repos?.["r"]).toEqual({
            publishTo: ["github"],
            generated: [String.raw`^src/a\.b\.ts$`],
        });
        setGenerated("src/a.b.ts", false, ["r"], path);
        expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
            generated: ["g"],
            repos: { r: { publishTo: ["github"], generated: [] } },
        });
    });

    test("exactPattern matches only the literal path", () => {
        const re = new RegExp(exactPattern("a+b/(c).ts"), "u");
        expect(re.test("a+b/(c).ts")).toBe(true);
        expect(re.test("aab/(c).ts")).toBe(false);
        expect(re.test("x/a+b/(c).ts")).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests to make sure that they fail**

Run: `bun test test/lib/store.test.ts test/lib/config.test.ts`
Expected: FAIL. The modules are not found.

- [ ] **Step 3: Create `src/lib/store.ts`**

```ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { DigestError } from "./errors";
import { storeDir } from "./paths";
import { CommentsFileSchema, type Comment } from "./schemas";

/** Writes a temp file in the same folder, then renames it, so a reader never sees half a file. */
export function writeAtomic(path: string, data: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, data);
    renameSync(temp, path);
}

export function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        throw new DigestError("BAD_INPUT", `${path} is not valid JSON.`, { cause: error });
    }
}

/** The working copy of a digest: `store/<repo>/<name>.md`. */
export function workingCopyPath(repo: string, name: string, home?: string): string {
    return join(storeDir(home), repo, `${name}.md`);
}

export function commentsPath(mdPath: string): string {
    return `${mdPath.replace(/\.md$/u, "")}.comments.json`;
}

export function readComments(mdPath: string): readonly Comment[] {
    const path = commentsPath(mdPath);
    if (!existsSync(path)) return [];
    const result = CommentsFileSchema.safeParse(readJson(path));
    if (!result.success) {
        throw new DigestError(
            "BAD_INPUT",
            `${path} does not match the comments schema:\n${z.prettifyError(result.error)}`,
        );
    }
    return result.data;
}

export function writeComments(mdPath: string, comments: readonly Comment[]): void {
    writeAtomic(commentsPath(mdPath), `${JSON.stringify(CommentsFileSchema.parse(comments), null, 2)}\n`);
}
```

- [ ] **Step 4: Create `src/lib/config.ts`**

```ts
import { existsSync } from "node:fs";
import { z } from "zod";
import { DigestError } from "./errors";
import { configPath } from "./paths";
import { BackendConfigSchema, ConfigFileSchema, type BackendConfig, type ConfigFile, type RepoConfig } from "./schemas";
import { readJson, writeAtomic } from "./store";

export interface ResolvedConfig {
    /** The repo keys that were tried, then the key that matched (if any). */
    readonly repoKeys: readonly [string, ...string[]];
    readonly key: string | undefined;
    readonly backends: Readonly<Record<string, BackendConfig>>;
    readonly publishTo: readonly string[];
    /** Global and repo patterns together. */
    readonly generated: readonly string[];
    /** Only the patterns in this repo's entry. "Mark generated" writes here. */
    readonly repoGenerated: readonly string[];
}

const DEFAULT_BACKENDS: Readonly<Record<string, BackendConfig>> = {
    github: BackendConfigSchema.parse({ type: "github" }),
};

export function readConfigFile(path: string = configPath()): ConfigFile {
    if (!existsSync(path)) return {};
    let raw: unknown;
    try {
        raw = readJson(path);
    } catch (error) {
        throw new DigestError("BAD_CONFIG", `${path} is not valid JSON.`, { cause: error });
    }
    const result = ConfigFileSchema.safeParse(raw);
    if (!result.success) {
        throw new DigestError("BAD_CONFIG", `${path} is not valid:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
}

export function resolveConfig(file: Readonly<ConfigFile>, repoKeys: readonly [string, ...string[]]): ResolvedConfig {
    const key = repoKeys.find(k => file.repos?.[k] !== undefined);
    const repo: RepoConfig = key === undefined ? {} : (file.repos?.[key] ?? {});
    const backends = file.backends ?? DEFAULT_BACKENDS;
    const publishTo = repo.publishTo ?? file.publishTo ?? ["github"];
    for (const name of publishTo) {
        if (backends[name] === undefined) {
            throw new DigestError("BAD_CONFIG", `publishTo names "${name}", but no backend has that name.`);
        }
    }
    return {
        repoKeys,
        key,
        backends,
        publishTo,
        generated: [...(file.generated ?? []), ...(repo.generated ?? [])],
        repoGenerated: repo.generated ?? [],
    };
}

/** A test for the config's generated patterns. The patterns are compiled once. */
export function generatedMatcher(config: ResolvedConfig): (path: string) => boolean {
    const patterns = config.generated.map(r => new RegExp(r, "u"));
    return path => {
        for (const pattern of patterns) if (pattern.test(path)) return true;
        return false;
    };
}

/** The pattern that "Mark generated" writes for one file. */
export function exactPattern(path: string): string {
    return `^${path.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}$`;
}

/** Adds or removes one file's exact pattern in this repo's entry. Keeps every other key as it was. */
export function setGenerated(
    path: string,
    on: boolean,
    repoKeys: readonly [string, ...string[]],
    file: string = configPath(),
): void {
    const current = readConfigFile(file);
    const key = repoKeys.find(k => current.repos?.[k] !== undefined) ?? repoKeys[0];
    const repo = current.repos?.[key] ?? {};
    const pattern = exactPattern(path);
    const rest = (repo.generated ?? []).filter(r => r !== pattern);
    const next = ConfigFileSchema.parse({
        ...current,
        repos: { ...current.repos, [key]: { ...repo, generated: on ? [...rest, pattern] : rest } },
    });
    writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
}
```

- [ ] **Step 5: Run the tests to make sure that they pass**

Run: `bun test test/lib/store.test.ts test/lib/config.test.ts`
Expected: 12 pass, 0 fail.

- [ ] **Step 6: Run the full check**

Run: `bun run verify`
Expected: all steps pass. The full suite has 37 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/store.ts src/lib/config.ts test/lib/store.test.ts test/lib/config.test.ts
git commit -m "minor: add comment store and config resolution"
```


---

## Carry-forward for plans 2–7 (from the plan 1 reviews)

Plan 1 is complete (45 tests). The final review fixed the diff parser (lines that start with `---`/`+++` inside a hunk), `-z` path parsing, YAML errors, nested-repo entries, the `publishTo` default, and the import-limit patterns. The code in Tasks 1–6 above is the code as it was before those fixes; git history has the final code.

These items are open. Each later plan must do the item that is assigned to it:

| Plan | Item |
|---|---|
| 2 | Add an oxlint override for `src/lib/digest.ts`, `src/lib/schemas.ts`, and `src/lib/model.ts` that blocks `node:*` and `bun` imports and the `Bun` global (the UI imports these files). |
| 2 | `ANCHOR` is an exported `g` regex, so it has shared `lastIndex` state. Use it only with `matchAll`, or export a factory. |
| 3 | Concurrent writes: the CLI runs procedures in-process while the server also writes `*.comments.json` and `config.json`. Design a lock file, or send all writes through one process. Today the last write wins. |
| 3 | `workingCopyPath(repo, name)` must slug or validate its arguments before the server takes names from requests (path traversal). |
| 4 | `resolveBase(root, ref?, head)` takes a git ref for `head`. Never pass `"worktree"`; map it to `"HEAD"`. |
| 6 | Add the `react-hooks` plugin and the `rules-of-hooks` and `exhaustive-deps` rules (spec §11.2). |
| any | `coverageGaps` matches a deleted file by a substring of its base name (`a.ts` matches `data.ts`). Behavior kept from the old tool. |
| any | `expandHome` does not expand a bare `~`. |
| 7 | Delete `scripts/install.mjs`, then remove its `ignorePatterns` entry. The suppression check also scans it until then. |
