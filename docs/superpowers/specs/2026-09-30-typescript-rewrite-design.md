# diff-digest: TypeScript rewrite — design

Date: 2026-09-30
Status: approved in chat, waiting for spec review

## 1. Goals

1. One app, with the entrypoints that we have today (CLI, server, UI, static export), in one `src/` tree.
2. TypeScript everywhere. Bun runs it and bundles it. React 19.3 for the UI.
3. Types and runtime validation from one source: zod schemas in `src/lib`.
4. Typed guardrails for agents: validated input and output for each command, structured errors, a digest linter and formatter.
5. Storage through a backend interface. Two backends: `github` and `local`.

Priorities, in this order when they conflict:

1. **Lightweight.** Few dependencies. No framework when the platform does the job.
2. **Fast.** Fast build, fast start, fast page load.
3. **Strongly typed.** The strictest TypeScript settings, type-aware lint rules, and no suppressions without approval (section 11).

Product rules:

1. **Agents write the Markdown, and the tool lints it.** All valid Markdown is allowed. Lint rules are for best practices and a good reading experience. No rule rejects a valid Markdown construct.
2. **A digest is viewable in any Markdown viewer:** glow, GitHub, GitLab, Obsidian, or a home-built viewer. The baseline is CommonMark + GFM (tables, strikethrough, autolinks, task lists). Mermaid is an extra: a digest must make sense when a viewer shows the diagram as source.

Non-goals: migration of old digests or old comment files, an MCP server, a browser test suite, CI.

## 2. Stack

| Concern | Choice | Version (2026-09-30) |
|---|---|---|
| Runtime, bundler, test runner | Bun | 1.4.2 |
| Language | TypeScript (native `tsc`) | 7.0.2 |
| UI | React, React DOM | 19.3.0 |
| CLI parser | `@stricli/core` | 1.3.0 |
| Schemas | `zod` | 4.6.5 |
| HTTP contract | `@orpc/contract`, `@orpc/server`, `@orpc/client`, `@orpc/openapi` | 1.15.4 |
| Markdown | `marked` | 18.0.14 |
| Diagrams | `mermaid` | 12.0.0 |
| Code highlight | `highlight.js` (core + registered languages) | 11.12.0 |
| Lint | `oxlint` + `oxlint-tsgolint` (type-aware) | 1.86.0 / 7.0.2003 |
| Format | `prettier` | 3.9.9 |

There is no Vite, no Babel, no React Compiler, no router, no state library, no TanStack Query, and no Hono. Bun's HTML imports bundle the UI. All packages come from `package.json`, and nothing loads from a CDN.

## 3. Layout

```
package.json          scripts: dev, build, typecheck, lint, format, test, verify, setup
tsconfig.json         section 11
.oxlintrc.json        section 11
.prettierrc.json
src/
  cli/
    index.ts          binary entrypoint (Stricli application)
    commands/*.ts     one file per command; parse → call lib or router client → print
  server/
    index.ts          startServer(): Bun.serve({ routes: { "/d/:id/": appHtml, "/rpc/*": orpcHandler } })
    router.ts         implements the contract
    lifecycle.ts      lock, server.json, idle exit, version check
  app/
    index.html        HTML import entry
    main.tsx
    api.ts            Api interface; live oRPC client; static read-only implementation
    components/       Toolbar, FileTree, Digest, Block, Anchor, CodePane, DiffView, FileView,
                      Menu, RangeSelect, Thread, Composer, PublishDialog, Toast
    hooks/            useDigest, useComments, useEvents
    styles.css
  lib/                no React; the only code that touches git, gh, and the disk
    schemas.ts        all zod schemas (section 6)
    contract.ts       oRPC contract
    errors.ts         DigestError and codes
    repo.ts           RepoContext; git wrapper
    diff.ts           changed files (with untracked files), classes, hunks, import and move filter
    config.ts         read, validate, setGenerated
    store.ts          working copies and comments; atomic writes
    paths.ts          ~/.diff-digest paths
    digest.ts         pure helpers for the UI too: block ids (cid), anchors, path match, circled numbers, line ends
    frontmatter.ts    parse and write the frontmatter (YAML)
    coverage.ts       hunks that no anchor covers
    model.ts          Markdown → typed Digest model (marked lexer)
    md.ts             marked tokens → typed blocks with lines (pure)
    lint/             rules on the model: rule.ts, frontmatter.ts, diagram.ts, structure.ts, content.ts, index.ts
    fmt.ts            safe auto-fixes
    render.ts         render / unrender for backends
    backends/
      types.ts        Backend interface
      registry.ts
      github.ts
      local.ts
docs/format.md        intro text; `diff-digest format` adds the rules from lint.ts
prompts/*.md          imported as text, so they are inside the binary
skills/diff-digest/SKILL.md
scripts/install.ts
test/
```

Dependency rules between folders:

- `cli` → `lib` and `server`.
- `server` → `lib`.
- `app` → only `lib/schemas.ts`, `lib/contract.ts`, and the pure helpers in `lib/digest.ts` and `lib/model.ts`. It imports no Node or Bun API.
- `lib` → no other folder in `src`.

An oxlint `no-restricted-imports` rule for each folder enforces these rules.

`bin/`, `ui/`, and `scripts/install.mjs` are deleted when the new CLI has all the current features.

## 4. Server lifecycle

There is one server for each user. No launchd and no systemd. The CLI manages the server.

| Command | Effect |
|---|---|
| `serve [ref] [--open]` | Starts the server if it is not running, registers the digest, prints `{ url, id }`, and exits at once. |
| `server status` | Shows the pid, port, version, uptime, and registered digests. |
| `server stop` / `server restart` | Stops or restarts the server. |
| `server logs [-f]` | Prints `~/.diff-digest/server.log`. |
| `server run [--dev]` | Runs in the foreground. `serve` uses this internally. `--dev` turns on HMR. |

- **Start:** `serve` spawns `process.execPath server run` with `detached: true`, sends the output to `server.log`, calls `unref()`, and exits.
- **Files:** `~/.diff-digest/server.json` holds `{ pid, port, version, startedAt }` and has a schema. `server.lock` is created with an exclusive create, so two `serve` calls cannot start two servers. If the lock holds a dead pid, the next `serve` takes the lock.
- **Registry:** the server knows a digest from its file in `store/`. There is no separate registry file.
- **Idle exit:** the server exits after 4 hours with no requests, no open tabs, and no `wait` callers.
- **Version:** if the CLI version is not the server version, `serve` restarts the server.
- **URL:** `http://127.0.0.1:<port>/d/<id>/`.
- **Safety:** the server binds to 127.0.0.1 only. For each `/rpc` request, `Host` must be `127.0.0.1:<port>`, and `Origin` must be absent or the same. If not, the server rejects the request.
- **Context:** one server handles many repos. So there are no module globals. Each lib function takes a `RepoContext { root, base, head: "worktree" | Sha }`.
- **Skill:** Claude runs `serve` as a normal command and runs only `wait` in the background.

## 5. Data and storage

### 5.1 Working copy

- Path: `~/.diff-digest/store/<repo>/<name>.md`. Comments: `<name>.comments.json` in the same folder. `<name>` comes from the target, as today: a branch slug, `commit-<sha>`, or `range-<a>-<b>`.
- `diff-digest init [ref]` creates the file with its frontmatter and prints `{ id, path }`. The agent writes the body with its own file tools.
- Frontmatter (tool-owned): `id` (short uuid), `base`, `head`, `branch`, `pinned`, and `meta` (free-form; the tool keeps it but does not read it).
- The tool writes the frontmatter, the comments, the config, and the store. The agent writes only the body.
- All writes are atomic: write a temp file, then rename it.

### 5.2 Digest reference

Each command that works on a digest takes one optional `ref`:

- nothing: the current branch
- a target: `#123`, a PR URL, a branch, a commit, `a..b`
- `--id <id>`
- a path to a `.md` file

`resolveDigest(ref)` returns `{ id, mdPath, repo: RepoContext, target }`. Each command uses it.

### 5.3 Backends

```ts
interface Backend {
  readonly name: string;                       // instance name from config
  readonly type: "github" | "local";
  locate(t: Target): Promise<Location | null>; // null: not usable for this target
  pull(loc: Location): Promise<Pulled | null>; // { markdown (links removed), meta, ref }
  publish(loc: Location, doc: Rendered): Promise<Published>;  // create or update
  publishReview(loc: Location, review: string): Promise<Published>;
  anchorLink(a: Anchor, ctx: LinkContext): string | null;
}
```

- Each backend is one file that exports `{ type, configSchema, create(config, deps) }`. `deps` holds `exec` (for `gh`), `fs`, and `now`, so tests can replace them.
- `Location`, `Published.ref`, and `BackendConfig` are discriminated unions on `type`.
- `render` converts anchors to standard `[text](url)` links and wraps the body in the backend's envelope. `unrender` does the opposite. A round trip through any backend gives the same body.
- The body is the same for all backends, and it must be portable (product rule 2). Only the envelope changes for each backend:
  - `github`: an HTML comment marker `<!-- diff-digest: {meta} -->`. GitHub hides it, and PR comments do not support frontmatter. A plain Markdown line at the end replaces the old `<sub>` footer.
  - `local`: YAML frontmatter with the meta and the `frontmatter` option. Obsidian, GitLab, and glow support frontmatter.

| | `github` | `local` |
|---|---|---|
| Where | One PR comment with a `<!-- diff-digest: {meta} -->` marker. The review uses its own marker. | `<dir>/<name>.md` and `<dir>/<name>.review.md` |
| `locate` | Finds the PR for the target with `gh` (any host) | Always usable. `dir` can use `{repo}` and `{branch}`. |
| Anchor links | Blob URL at the head sha | `linkTemplate`: `none`, or a template with `{root}`, `{path}`, `{start}`, `{end}`, `{sha}` (for example `vscode://file/{root}/{path}:{start}`) |
| Extra | Checks the 65,536-character limit | `frontmatter` option, for example Obsidian tags |

### 5.4 Config

`~/.diff-digest/config.json`, validated by zod:

```json
{
  "backends": {
    "github": { "type": "github" },
    "notes": {
      "type": "local",
      "dir": "~/Obsidian/Work/diff-digests/{repo}",
      "linkTemplate": "vscode://file/{root}/{path}:{start}",
      "frontmatter": { "tags": ["diff-digest", "{repo}"] }
    }
  },
  "publishTo": ["github"],
  "generated": [],
  "repos": { "lca": { "publishTo": ["github", "notes"], "generated": ["(^|/)BUILD\\.bazel$"] } }
}
```

- `publish [ref] [--to a,b] [--dry-run] [--force]`. With no `--to`, the command uses `publishTo`.
- `pull <ref> [--from a]`. With no `--from`, the command uses the first backend that returns a digest.
- `comments [ref] --publish [--to …]` posts the review. Each posted comment gets `status: "shared"` and a `ref`.
- `digestDir` is no longer a key. The tool gives an error for an unknown key.

## 6. Schemas and errors

`src/lib/schemas.ts` defines, with zod 4: `Config`, `BackendConfig`, `Frontmatter`, `StoreFile`, `Comment`, `CommentTarget`, `ChangedFile`, `Hunk`, `DigestPayload`, `FilePayload`, `Action`, `LintIssue`, `Location`, `Pulled`, `Published`, `ServerInfo`, and the `Digest` model.

- `CommentTarget` is a union: `{ kind: "digest", cid, section, text }` or `{ kind: "code", path, rev: "base" | "head", line, endLine?, text }`.
- `Comment.status`: `open`, `resolved`, `note`, or `shared`.
- The TypeScript types come from the schemas with `z.infer`. There is no second, hand-written type.

`src/lib/errors.ts`:

```ts
class DigestError extends Error { code: ErrorCode; hint?: string; data?: unknown }
type ErrorCode = "BAD_INPUT" | "NOT_FOUND" | "LINT_FAILED" | "COVERAGE_GAP" | "STALE"
               | "NO_BACKEND" | "BACKEND_FAILED" | "BAD_CONFIG" | "SERVER_DOWN" | "GIT_FAILED" | "LOCKED";
```

- Each code has its own exit code. Usage errors exit with 2.
- With `--json`, the output is `{ ok: true, data }` or `{ ok: false, error: { code, message, hint, data } }`.

## 7. HTTP contract

`src/lib/contract.ts` (oRPC, contract-first). `server/router.ts` implements it, so the typecheck fails if a procedure is missing or returns the wrong shape. oRPC validates the input and the output at runtime.

| Procedure | Callers |
|---|---|
| `digest.get`, `digest.lint` | UI; `lint`, `check` |
| `files.diff`, `files.read` | UI code pane |
| `files.setGenerated` | UI ⋯ menu; `mark` |
| `comments.list`, `add`, `remove`, `resolve`, `note`, `markShared` | UI; `comments`, `resolve`, `note` |
| `publish.digest`, `publish.review`, `publish.backends` | UI publish dialog; `publish`, `comments --publish` |
| `actions.send` | UI Apply and Review |
| `actions.wait` (event iterator) | `wait` |
| `events` (event iterator) | UI live reload and listener status |

- The CLI calls these procedures in-process with `createRouterClient`. So the CLI and the UI run the same handler with the same validation, and the CLI does not need the server for them. Only `wait` and `serve` need the server.
- `schema --openapi` prints the OpenAPI spec from `@orpc/openapi`.

## 8. CLI

Stricli application. Each command is one file.

| Group | Commands |
|---|---|
| Target | `target [ref]`, `init [ref]`, `path [ref]`, `hunks [ref]` |
| Format | `lint [ref]`, `fmt [ref] [--check]`, `check [ref]`, `format` |
| Review | `serve [ref] [--open]`, `wait [ref]`, `comments [ref] [--json \| --markdown \| --publish]`, `resolve <id> <reply>`, `note <text> <body>`, `mark <path> [--off]` |
| Backends | `publish [ref]`, `pull <ref>`, `export [ref]` |
| Admin | `server run \| status \| stop \| restart \| logs`, `config [--init]`, `prompt <name>`, `schema [name] [--openapi]` |

- Each command validates its output against its schema before it prints. So the JSON that an agent reads always matches `diff-digest schema <name>`.
- `--json` is available on every command that prints data.

## 9. Format enforcement

The agent writes Markdown. The tool parses it, checks it, and fixes it.

- `md.ts` parses the body with the `marked` lexer into typed blocks with file lines; list items and blockquotes keep their nested blocks. `model.ts` builds the typed `Digest` from them: title, sections (each with its blocks), the architecture diagram (Mermaid source, numbered nodes), the notes list, the Changes items, and block ids. The generated list, the tests, and the test gaps are read from their sections.
- `lint.ts`: each rule is `{ id, severity, description, check(model, ctx) → LintIssue[] }`. A `LintIssue` is `{ rule, severity, line, message, hint }`.
- Severity follows product rule 1:
  - `error` is only for facts that are wrong. The digest does not agree with the code, or the tool cannot read the digest.
  - `warn` is for best practices and portability. A warning never blocks a command.
- No rule rejects valid Markdown. An unknown section, HTML, or any other valid construct gets at most a warning.

| Rule | Severity | Check |
|---|---|---|
| `frontmatter` | error | The frontmatter matches the schema. |
| `anchor-resolves` | error | Each anchor resolves to a file and a line range that exists. |
| `node-numbers` | error | The circled numbers are in sequence and the same in the diagram, the notes list, and the Changes bullets. |
| `changed-node-marked` | warn | Each changed node has `:::changed` and a circled number. |
| `diagram-notes` | warn | Each numbered node has a note below the diagram, so the digest makes sense without the picture. |
| `diagram-size` | warn | The diagram has fewer than 12 nodes. |
| `section-order` | warn | The known sections are in order. |
| `unknown-section` | warn | A section is not in the format. |
| `no-questions` | warn | No Questions section. Use agent notes. |
| `no-intent` | warn | No intent phrases: `in order to`, `the author`, `intended to`, `we want`, `the goal`, `to make it easier`. The list is a constant in `lint.ts`. |
| `no-inline-html` | warn | No HTML in the body. Some viewers do not render it. |
| `no-wikilinks` | warn | No `[[x]]` links. Only Obsidian renders them. |
| `link-style` | warn | Only standard `[text](url)` links and autolinks. |
| `table-max-columns` | warn | Tables have at most 5 columns, so they fit in a terminal viewer. |

- Callouts (`> [!NOTE]`) are allowed with no warning. Viewers that do not know them show a blockquote.
- `fmt.ts` is optional. It makes only the fixes that cannot change the meaning, and it never deletes content:
  - section order
  - ①②③ numbering in the diagram, the notes, and the Changes bullets
  - the `classDef changed` line
  - anchor style
  - table alignment
- `fmt --questions-to-notes` moves a Questions section into agent notes. It does this only when you give the flag.
- `fmt` is idempotent: a second run gives the same output.
- `check` = `lint` + anchor coverage. `publish` refuses a digest with errors, unless you give `--force`. Warnings never block `publish`.
- `diff-digest format` prints `docs/format.md`, then the list of rules from `lint.ts`. So the documentation and the enforcement do not drift apart.

## 10. UI

- React 19.3. Data comes from the `Api` interface through `useDigest`, `useComments`, and `useEvents` (`use()` + Suspense). An `events` message makes the hooks fetch again.
- The UI renders CommonMark + GFM, the same baseline as product rule 2, so the UI shows what other viewers show.
- The digest renders from `marked` tokens into React elements. The UI does not change the DOM after the render. Block ids (`cid`) come from `lib/digest.ts`, so the UI, the linter, and the comments use the same ids.
- The features are the same as today:
  - comments on digest blocks
  - anchors that open the code pane
  - Diff, After, and Before views
  - the unchanged-file tag
  - drag-to-select range comments
  - the file tree
  - the ⋯ menu with Mark generated
  - apply and review actions
  - the listener status
- New: `PublishDialog`. You select one or more backends, preview the rendered output, and publish.
- `mermaid` loads with `await import("mermaid")`. The bundler puts it in its own chunk inside the binary, and the browser parses it only when a digest has a diagram. `highlight.js` uses the core build with about 12 registered languages.
- One `styles.css` with the current design tokens.
- Static `export` uses the read-only `Api` with a payload inside the page. The build makes the static bundle once, and the binary contains it as a file import.

## 11. Strictness

### 11.1 TypeScript (`tsconfig.json`)

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no enums or namespaces), `isolatedModules`, `skipLibCheck: false`, `module: "preserve"`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `noEmit`.

### 11.2 oxlint (`.oxlintrc.json`)

Categories `correctness`, `suspicious`, `perf`, and `pedantic` set to `error`. Plugins: `typescript`, `react`, `react-hooks`, `import`, `unicorn`, `promise`. Type-aware rules come from `oxlint --type-aware` (tsgolint). These rules are `error`:

- `typescript/no-explicit-any`, `no-non-null-assertion`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`, `no-unsafe-argument`
- `typescript/no-floating-promises`, `no-misused-promises`, `await-thenable`, `require-await`
- `typescript/switch-exhaustiveness-check`, `strict-boolean-expressions`, `no-unnecessary-condition`, `prefer-nullish-coalescing`
- `typescript/consistent-type-assertions` with `assertionStyle: "never"`: no `as` casts. zod parses unknown data. `as const` is allowed.
- `typescript/consistent-type-imports`, `typescript/ban-ts-comment` (all forms)
- `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`
- `no-restricted-imports` for each folder (section 3)
- `no-console` in `src/lib` and `src/app`. Output goes through the CLI's printer.

### 11.3 No suppressions without approval

- `scripts/check-suppressions.ts` runs in `bun run lint`. It fails on these strings in `src/`, `scripts/`, and `test/`: `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `oxlint-disable`, `eslint-disable`, and `prettier-ignore`.
- The only exception is an entry in `suppressions.json`, as `{ file, line text, rule, reason, approvedBy }`. Only the user adds entries.
- The repo `CLAUDE.md` says that an agent must not add a suppression or a `suppressions.json` entry without explicit approval from the user.

### 11.4 Prettier

`printWidth: 120`, `tabWidth: 4`, `trailingComma: "all"`, `arrowParens: "avoid"`. This matches the current code style. `bun run format` writes the changes, and `bun run lint` runs `prettier --check`.

### 11.5 `verify`

`bun run verify` = `typecheck` + `lint` (oxlint + suppressions + prettier check) + `test`. Each change must pass `verify` before a commit.

## 12. Build and install

- `dev`: `bun --hot src/cli/index.ts server run --dev`
- `build`: `bun build --compile --minify --sourcemap src/cli/index.ts --outfile dist/diff-digest`. The UI, the static export bundle, the docs, and the prompts are inside the binary.
- `setup`: `build`, then copy the binary to `~/.local/bin/diff-digest`, then copy the skill to `~/.claude/skills/diff-digest/`. The options `--bin-dir`, `--skills-dir`, `--force`, and `--uninstall` stay.
- A cold `diff-digest --help` must take less than 50 ms. Stricli loads commands lazily, so a command imports only what it uses.

## 13. Tests

`bun test`, with temp git repos as fixtures:

- `diff`: parsing, file classes, untracked files, binary detection, the empty-tree base, the import and move filters
- `lint`: each rule, with a pass case and a fail case. One test checks that a digest with only valid but unusual Markdown has no `error` issues.
- `fmt`: each fix, and idempotence
- `render` / `unrender`: a round trip for each backend. One test checks that the rendered body has no HTML other than the `github` marker.
- `store`: atomic writes; data that does not match the schema is rejected
- contract: the router client against a fixture repo, for each procedure
- backends: `github` with a fake `exec`; `local` with a temp folder
- `lifecycle`: the lock, a stale pid, and the version restart

The UI gets a manual Playwright check. No browser test dependency is added.

## 14. Rollout

The work is on `main`, in this order. Each step passes `verify`.

1. Tooling: `package.json`, `tsconfig.json`, oxlint, Prettier, the suppression check, the repo `CLAUDE.md`
2. `lib` (schemas, errors, repo, diff, config, store, digest) + tests
3. `model`, `lint`, `fmt`, `render` + tests
4. Contract + router + server lifecycle + tests
5. CLI commands
6. Backends (`github`, `local`) + tests
7. UI
8. Skill, README, and `docs/format.md`
9. `setup`. Then delete `bin/`, `ui/`, and `scripts/install.mjs`.
