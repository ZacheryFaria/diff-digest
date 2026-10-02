# Plan 7: Binary, export, setup, and cutover

**Goal:** One compiled `diff-digest` binary with the UI inside, the static `export` command, `setup` with the new installer, and the cutover: the skill, the format doc, and the prompt move to the new CLI, and the old tool (`bin/`, `ui/`, `prompts/`, `scripts/install.mjs`) is deleted.

**Spec:** `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md` §1, §3, §8, §10 (static export), §12 (build and install), §14 steps 8–9. Carry-forward tables at the end of the plan 1–6 files.

**Execution:** the controller builds each task in the repo with `bun run verify` passing before each commit, then an Opus whole-plan review, one fix wave, and a re-review (user goal 2026-10-01). The binary gets a manual Playwright check.

## Global constraints

- Same as plans 1–6. No new runtime dependencies.
- The binary is `bun build --compile --minify --sourcemap --splitting --define process.env.NODE_ENV='"production"' src/cli/index.ts --outfile dist/diff-digest`. A spike on 2026-10-02 showed that without the define the page gets development React (StrictMode runs each fetch two times), and without `--splitting` Mermaid is not in its own chunk (one 6 MB script).
- A warm `diff-digest --help` takes less than 50 ms (spike: 20–30 ms). The first run of a new binary on macOS can take about 1 s (the system checks it); the guard runs the binary one time before it measures.
- Nothing loads from a CDN, also in the static export.

## Rulings in this plan

| Ruling | Why |
|---|---|
| The static export has parity with the old export: the digest, the meta chips, and the file tree. Anchors and files link to the repo web URL at the head commit when the origin is a known host; else they are plain code. No code pane, no comments, no actions. | `bin/diff-digest.mjs` `cmdExport`, `ui/app.js` `STATIC`. |
| The export page uses the same React app with a read-only `ApiClient` made with `implement(contract)` + `createRouterClient` over the payload in the page. Writes throw `READ_ONLY`. `AppActions` gains `readOnly` and `repoUrl`, and the components hide the write controls. | One app; spec §10 "read-only `Api` with a payload inside the page". |
| The export bundle (`src/app/export.html` → `export.tsx`, no splitting, so Mermaid is inline) comes from a Bun macro (`src/cli/export-assets.ts`): `bun build --compile` runs it once and puts the strings in the binary; from source it runs when `export` loads. The macro runs `bun build` as a process, because a macro cannot call `Bun.build`. | Extra `--compile` entry points are bundled as modules, not embedded, so `Bun.embeddedFiles` was empty (found in the build). |
| `server run --dev` serves with `development: true` (HMR); `bun run dev` is `bun --hot src/cli/index.ts server run --dev`. | Spec §12. |
| `setup` is `scripts/install.ts` (TypeScript, same flags). It builds, copies the binary to `--bin-dir`, copies the skill, writes the markers, and removes the old `~/.diff-digest/lib` when it has the old marker. | Spec §12; the old install put the tool in `lib/`. |
| A restarted server tries its last port first (kept in `~/.diff-digest/server.port`), so an open page reconnects. | Plan 6 carry-forward. |

## Tasks

1. **Build and binary.** `scripts/build.ts`, `build` and `dev` scripts, `.gitignore` `dist/`, `server run --dev`, a favicon data URI in `index.html`. Test (`test/build/binary.test.ts`): build to a temp dir; `--version` matches `VERSION`; warm `--help` median of 5 < 50 ms; `serve` from the binary returns the page, and no served chunk contains `Download the React DevTools`.
2. **Static export.** `export [ref] [--out <file>] [--open]` (default out: the working copy path with `.html`), `src/app/static-api.ts`, `src/app/export.tsx`, the `readOnly` and `repoUrl` UI paths, the embedded bundle. Tests: the HTML has the payload in a `<script type="application/json">` with `<` escaped, inline CSS and JS, no `http(s)` `src` or stylesheet `href`; anchors use the repo URL; the read-only client rejects writes.
3. **Setup.** `scripts/install.ts` (`--bin-dir`, `--skills-dir`, `--force`, `--uninstall`), the `setup` script. Test with temp dirs: install, guard against a foreign file, `--force`, uninstall keeps the config and the store, removes the old `lib/`.
4. **Cutover.** Rewrite `skills/diff-digest/SKILL.md` for the new CLI (`init`, `hunks`, `fmt`, `check`, `serve`, `wait`, `note --ref`, `publish`, `pull`, `export`); rewrite `docs/format.md` with no rule list of its own (`format` prints the rule table); the CLI prompt stays at `src/cli/prompts/review-agent.md`; delete `prompts/`, `bin/`, `ui/`, `scripts/install.mjs`; README; the repo `CLAUDE.md`.
5. **Carry-forward.** The last port; `meta: {}` in new frontmatter; `fmt --questions-to-notes` skips an equal note; `init --base X` on an existing working copy says that it kept the old base; a git spawn on a deleted root is NOT_FOUND; `server logs -f`.

## Carry-forward

| Plan | Item |
|---|---|
| — | `publish` with no backend already fails with NO_BACKEND and a hint; the plan 6 row came from a dry run where the default `github` backend was skipped (no PR). |
| any | Adding an `origin` remote to a repo changes its repo key, so `[ref]` no longer finds a working copy made before (`--id` still does). |
| any | The PR chip and the stale-head chip need payload fields (plan 6 carry-forward). |
| any | `VERSION` is still 0.2.0. Bump it with the first release of the binary. |
| any | The user's installed tool is the old one until they run `bun run setup` in the clone. |
