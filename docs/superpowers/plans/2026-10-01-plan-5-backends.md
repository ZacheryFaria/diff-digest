# Plan 5: Backends (github, local)

**Goal:** Publish and pull digests and review comments through one `Backend` interface, with a `github` backend (PR comments through `gh`) and a `local` backend (Markdown files in a folder, for glow, vim, or Obsidian). Add PR targets.

**Spec:** `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md` §1 (product rules: portable Markdown), §5.3 (backends), §5.4 (config), §7 (`publish.*` procedures), §8 (`publish`, `pull`, `comments --publish`). Carry-forward tables at the end of the plan 1–4 files.

**Execution:** the controller builds each task in the repo with `bun run verify` passing before each commit, then an Opus whole-plan review, one fix wave, and a re-review (user goal 2026-10-01).

## Global constraints

- Same as plans 1–4.
- The body is the same for every backend and must be portable. Only the envelope changes: `github` uses a hidden `<!-- diff-digest: {meta} -->` marker (and `<!-- diff-digest-comments: {meta} -->` for reviews); `local` uses YAML frontmatter.
- Backends never run a process directly: they get `deps.exec(command, args, input?) → { ok, stdout, stderr }` and `deps.fs`, so tests replace them.
- `publish` refuses a digest that has lint errors, unless `--force`. Warnings never block.

## Rulings in this plan

| Ruling | Why |
|---|---|
| `Target` gets a `pr` kind and an optional `pr` field (`{ host, owner, repo, number, url, headRef, headSha, baseSha }`). PR targets need `gh`; they go through the github backend's `resolvePr`. | Spec §5.2 lists PR targets. |
| A PR whose branch is not checked out is pinned to the PR head; its commits are fetched (`pull/<n>/head`), as the old tool did. | Parity with `bin/diff-digest.mjs`. |
| `publish.digest`, `publish.review`, and `publish.backends` are added to the contract; the CLI calls them in-process, the UI over HTTP. | Spec §7. |
| A `Published` result is `{ backend, ref, updated, warnings }`; `ref` is a URL (github) or a file path (local). | One shape for both backends. |
| `pull` writes the working copy only when none exists, unless `--force`. | The old tool's rule. |
| The github footer is a plain Markdown line: `diff-digest · open locally: /diff-digest <pr-url>`. | Product rule 2 (no `<sub>` HTML). |

## Tasks

1. **Backend interface, registry, and the local backend.** `src/lib/backends/types.ts`, `registry.ts`, `local.ts`, `envelope.ts` (meta marker and YAML envelopes, shared parse). Tests with a temp folder: publish, update, pull round trip, review file, link template, frontmatter option.
2. **The github backend.** `src/lib/backends/github.ts` (`gh api` for PR info, comments list/create/update; the 65,536-character limit; blob links at the head sha), `src/lib/backends/pr.ts` (parse `#123` and PR URLs, `resolvePr`, fetch commits). Tests with a fake `exec`.
3. **PR targets.** `src/cli/target.ts` gets the `pr` kind through the github backend; `target`, `init`, and the digest reference accept PR refs.
4. **Publish procedures and commands.** Contract + router (`publish.digest`, `publish.review`, `publish.backends`), `src/lib/publish.ts` (choose backends from `--to` or `publishTo`, render with each backend's linker, refuse lint errors unless forced, mark posted comments `shared` with the ref), CLI `publish [ref] [--to] [--dry-run] [--force]`, `pull <ref> [--from] [--force]`, `comments --publish [--to]`.

## Carry-forward for plans 6–7

| Plan | Item |
|---|---|
| — | Fixed after the re-review: a skipped backend plus a failed one is BACKEND_FAILED (one failure keeps its own code); a dry run settles each backend and checks for all-failed; `pull` fetches a missing head from the PR repo; git runs with `GIT_TERMINAL_PROMPT=0`; `.` and `..` are not GitHub names; the origin-repo match ignores case. |
| any | `ensurePrCommits` fetching from another repo's URL has no test (ruled acceptable). |
| any | `find.ts` re-exports `backendsFor`, to keep `pull.ts` at 10 imports. |
