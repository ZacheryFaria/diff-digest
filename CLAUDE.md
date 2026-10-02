# diff-digest

- Run `bun run verify` before each commit. It must pass.
- Do not add a lint, type, or format suppression (for example `@ts-expect-error` or an `oxlint-disable` comment). Do not add an entry to `suppressions.json`. Do not turn off a lint rule or a compiler option. If you think that one is necessary, stop and ask the user first.
- Do not use `as` type assertions. Parse unknown data with the zod schemas in `src/lib/schemas.ts`. `as const` is allowed.
- Name each zod schema `XSchema`, and its type `X`. Schemas use `.readonly()`. Build new values; do not change parsed values.
- `src/lib` must not import from `src/cli`, `src/server`, `src/app`, or React. The pure lib files (the UI imports them) must not import Node or Bun APIs; `.oxlintrc.json` lists them.
- `src/app` imports only the pure lib files. The UI does not change the DOM after React renders it.
- After a UI change, check it by hand with Playwright, then delete `.playwright-mcp/` (Prettier checks it).
- Write documentation in ASD-STE100 Simple Technical English.
- Commits use conventional commits with the types `minor`, `bugfix`, `major`, and `chore`. Do not add a co-author line.
- The design is in `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md`.
- Do not commit implementation plans or notes. `docs/superpowers/plans/` and `docs/notes/` are git-ignored; keep them local and short-lived.
