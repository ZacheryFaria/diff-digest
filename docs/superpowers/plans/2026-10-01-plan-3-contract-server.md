# Plan 3: Contract, router, and server lifecycle

**Goal:** One typed HTTP contract (oRPC) that the server implements and that the CLI (plan 4) and the UI (plan 6) call, plus a background server that the CLI starts, checks, and stops without system units.

**Spec:** `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md` §4 (lifecycle), §5 (store), §7 (contract). Carry-forward tables at the end of the plan 1 and plan 2 files.

**Execution:** the controller builds each task directly in the repo with `bun run verify` passing before each commit, then an Opus whole-plan review, one fix wave, and a re-review (user goal 2026-10-01: "keep going until plan 7 is done").

## Global constraints

- Same as plans 1–2: exact versions, strict TypeScript, oxlint type-aware, no suppressions, no `as` (except `as const`), `XSchema` names, readonly schemas, `u` regexes, ≤300 lines per file, ≤50 lines per function in `src/`, conventional commits with no co-author line, work on `main`, do not edit `bin/`, `ui/`, `scripts/install.mjs`.
- New exact dependencies: `@orpc/contract`, `@orpc/server`, `@orpc/client` 1.15.4 (runtime); `@opentelemetry/api` 1.9.1 (dev only: oRPC's `.d.ts` files refer to its types, and `skipLibCheck` is false).
- Lint config change approved by the user on 2026-10-01: `prefer-readonly-parameter-types` gets `ignoreInferredTypes: true`. Library callbacks (oRPC handler options, Bun `fetch(request)`) pass; every parameter that we type is still checked.
- `src/lib/contract.ts` is pure (the UI imports it) and is added to the purity override. This makes the rule stricter.
- Server binds to 127.0.0.1 only. Each `/rpc` request must have `Host: 127.0.0.1:<port>` and an `Origin` that is absent or the same origin.

## Rulings in this plan (decisions that differ from or add to the spec)

| Ruling | Why |
|---|---|
| The server keeps `~/.diff-digest/registry.json` (`id → { mdPath, root }`), written by `serve`. | The spec says the store is the registry, but a working copy path does not tell the server which repo root it belongs to. |
| `actions.wait` is a long-poll procedure that returns one `Action` (or `{ type: "timeout" }`), not an event iterator. | One action per call is all `diff-digest wait` needs, and a plain procedure is simpler to call from the CLI. |
| Concurrent writes (plan 1 carry-forward): `withLock(file, fn)` in `src/lib/lock.ts` (an atomic `mkdir` lock directory, stale after 30 s), used by every read-modify-write of comments, config, and the registry. | The CLI writes in-process while the server writes too. |
| `workingCopyPath` rejects a `repo` or `name` that is empty, `.`, `..`, or contains `/` or `\` (plan 1 carry-forward). | The server takes names from requests. |
| `digest.check` returns `{ issues, gaps }` (lint + anchor coverage), and the anchor checker for `lint` lives in `src/lib/payload.ts`. | `check` is used by both the CLI and `publish`, so it belongs behind the contract. |
| The version is a constant in `src/lib/version.ts`; a test checks that it equals `package.json`. | No `resolveJsonModule` change. |
| Until plan 6, `GET /d/:id/` returns a small static HTML page. | The React UI does not exist yet. |
| The server lock is `server.json.lock` (the `withLock` directory), not a `server.lock` file. A lock is stale when it is old and its owner pid is dead. | One lock implementation for every shared file. |
| The server, payload, action, and event schemas are in `src/lib/schemas-api.ts`, not `schemas.ts`. | `schemas.ts` would pass the 300-line limit. |
| `src/lib/schemas-api.ts` and `src/lib/client.ts` are added to the purity override, with `contract.ts`. The UI imports all of them. | This makes the rule stricter, so it needs no approval (the plan 2 carry-forward said it did; that was wrong). |
| `publish.digest`, `publish.review`, and `publish.backends` are not in this contract. Plan 5 adds them with the backends. | The backends do not exist yet. |
| `GET /health` returns `{ version, pid }`. The lifecycle signals a pid only after `/health` confirms it. | A stale `server.json` can name a pid that the system gave to another process. |
| `ensureServer(command)` takes the command that starts `server run`, so tests can start the server from source. Plan 4 passes the CLI's own command. | Testable lifecycle. |

## Tasks

1. **Dependencies, lint config, lock, registry, version.** `package.json`, `.oxlintrc.json`, `src/lib/lock.ts`, `src/lib/registry.ts`, `src/lib/version.ts`, `src/lib/store.ts` (`updateComments`, path checks), `src/lib/config.ts` (`setGenerated` under the lock), schemas (`RegistrySchema`, `ServerInfoSchema`). Tests: lock (wait, stale), registry round trip, path checks, version.
2. **Payloads.** `src/lib/payload.ts`: `openDigest(entry)` → `{ entry, frontmatter, body, ctx }`, `digestPayload`, `diffPayload`, `filePayload` (ported from `bin/diff-digest.mjs`, with the "unchanged" case), `anchorChecker`, `checkDigest` → `{ issues, gaps }`. Schemas: `DigestPayloadSchema`, `DiffPayloadSchema`, `FilePayloadSchema`. Tests with a temp repo and a working copy.
3. **Contract and router.** `src/lib/contract.ts` (digest.get/lint/check, files.diff/read/setGenerated, comments.list/add/remove/resolve/note/markShared, actions.send/wait/status, events), `src/server/router.ts`, `src/server/bus.ts` (events per digest id), `src/server/actions.ts` (queue + waiters). Tests through `createRouterClient`.
4. **HTTP server.** `src/server/http.ts`: `startServer({ port, home })` with `Bun.serve`, the RPC handler, the Host/Origin check, the placeholder page, file watching that publishes `digest` and `comments` events, and the idle timer. Tests: RPC over HTTP with the typed client, rejected Host/Origin, an event after a comment is added, send → wait.
5. **Lifecycle.** `src/server/lifecycle.ts`: `server.json`, `server.lock`, `readServerInfo`, `isAlive`, `ensureServer(command)`, `stopServer`, version restart; `src/server/main.ts` (the `server run` entry until plan 4). Tests: start from source in a temp home, status, a second `ensureServer` reuses it, stop, a stale `server.json`.

## Carry-forward for plans 4–7

| Plan | Item |
|---|---|
| 4 | (Done in plan 4 Task 1.) A change in the first poll tick after a stream subscribes got no event; the baseline is now the subscribe time. |
| any | `withLock` takeover still has a narrow race with three callers during the takeover of a dead holder's lock. A later fix: a lock file made with `O_EXCL`, with the owner token inside. |
| any | A dead holder's pid that the system reuses keeps the lock "live" until a person removes it (the `LOCKED` hint says so). |
| 6 | A queued click expires after 10 minutes without a `status` event; the UI must refresh the status or show a notice. Consider an expiry as long as `MAX_WAIT_MS`. |
| any | `startLocked` waits the full 10 s when the child starts and exits at once (for example a port in use); listen for the child's `exit`. |
| any | The test suite takes about 16 s, because the lifecycle tests start real servers. |
