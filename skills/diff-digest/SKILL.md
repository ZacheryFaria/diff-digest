---
name: diff-digest
description: Compress a branch diff into a short change spec (Markdown + Mermaid) and serve it in a local review UI with a code pane, per-line comments, "Apply comments", and "Review with agent". TRIGGER when the user asks to digest, compact, summarize for review, or "make reviewable" a diff or branch, or asks for a review artifact or HTML review page. DO NOT TRIGGER for a PR description only or for a bug hunt.
---

# Diff Digest

A digest is a **change spec**. It is much smaller than the diff, and a reviewer can match every claim to the code.

**The test for a good digest:** give it and the base commit to a new agent of the same model class. That agent must be able to make a change that behaves the same way. The code does not need to be identical.

## Files

Run all commands from the repo or worktree. The skill needs the `diff-digest` command on `PATH`. If the command is missing, tell the user to install it (see the diff-digest README).

Get the digest path with `diff-digest path`. The default is `~/.diff-digest/<repo>/<branch>.md`. Set `DIFF_DIGEST_DIR` to use another folder. If the user's instructions give a place for working files, use that place.

| File | Contents |
|---|---|
| `<name>.md` | The digest. You write this file. |
| `<name>.comments.json` | Comments from the review UI. Use the CLI to change it. Do not edit it by hand. |
| `<name>.server.json` | The URL of the running server. |

## Procedure

1. **Base.** Use the merge-base with the default branch (`origin/main` or `origin/master`), or the base that the user gives.
2. **Hunks.** Run `diff-digest hunks --base <base>`. It sorts files into `generated`, `test`, and `source`, and lists the reviewable hunks. Import-only hunks and moved code are already removed.
3. **Read** the source and test hunks. Do not read generated files.
4. **Write** the digest in the format below.
5. **Check.** Run `diff-digest check <md>`. Each gap is a hunk that the digest does not explain. Fix every gap. Before you write a claim such as "no code reads X", verify it with `grep`.
6. **Serve.** Start two background tasks with `run_in_background: true` and `timeout: 7200000`:
   - `diff-digest serve <md> --open`. This keeps running. Start it only once.
   - `diff-digest wait <md>`. This exits when the user clicks a button, and the exit wakes you.
7. **Tell the user** the URL and the open questions. Then stop and wait.

## When `wait` exits

The output starts with `ACTION: <type>`, followed by JSON that contains the open comments.

- **`apply`**: For each comment, change the digest (or the code, if the comment asks for that). Then run `diff-digest resolve <md> <id> "<one-line reply>"`. Run `check` again.
- **`review`**: Start a **new** agent with the Agent tool. Use `subagent_type: general-purpose`, do not use a fork, and do not set a model. Give it the prompt in `review-prompt.md` (in this skill's folder), with the placeholders filled in. The agent edits the digest and adds `note` comments itself. When it finishes, run `check` and give the user a short summary.
- **`timeout`** or **`error`**: If the server is not running, start it again.

After each action, start `wait` again. The page reloads by itself when the digest or the comments change.

## Format

````markdown
---
branch: <branch>
base: <short sha>
head: <short sha>
---

# <What changed, in one line>

**Generated (not reviewed):** `package-lock.json`

## Architecture

```mermaid
flowchart LR
  ...modules and data flow; mark changed nodes with :::changed and a number ①②③
  classDef changed stroke:#ffc430,stroke-width:2px
```

1. One or two lines for each numbered node: what is different at that point.

## Changes

- `oldThing(a, b)` is now `newThing(a)`. The `b` check moved to the caller: `path/file.ts:10-14`

### <Behavior table name> `path/file.ts:120-140`

| Case | Before | After |
|---|---|---|

## Tests

| Test | Proves | Why this case |
|---|---|---|

### Test gaps

| Behavior | Missing case | Why it matters |
|---|---|---|

## Questions

- Q1: ...
````

## Rules

- **No intent.** Do not guess why the author made the change. Describe only what the code does.
- **Generated files.** Only list them. Never describe them. `hunks` marks these files as `generated`: lockfiles, snapshots, `__generated__/`, generated protos, and minified or map files. Add more patterns with `DIFF_DIGEST_GENERATED` (regexes, comma-separated).
- **Do not mention** import changes, reordered code, or moved code that is otherwise identical.
- **Architecture diagram.** Show modules, components, stores, and data flow. Do not show functions. Keep it under 12 nodes. Mark the changed nodes and explain each one in one or two lines below the diagram. If the change touches only one module, leave the diagram out.
- **Changes.** One bullet for each change. Use this form: *what it was → what it is, and what moved where*, with anchors. Put renames here, not in a separate section.
- **Tables.** Use a table when the behavior depends on a combination of inputs. Use real cases as rows and columns, for example user role × page section. Do not use boolean formulas. Put the values as `before → after` in the cells, or in Before and After columns. Put ⚠️ where a user can see a change or where a change is not safe. Keep unchanged rows when they prove that behavior is equivalent.
- **Anchors.** Write each anchor as a code span: `path:line` or `path:start-end`. Use line numbers in the new file. A unique path suffix is enough. Anchors open in the code pane of the UI.
- **Tests.** For each added or changed test, give the behavior that it proves and why that case was chosen (a regression, an edge case, or an invariant). Put each ⚠️ behavior that has no test in Test gaps.
- **Questions.** Include only questions that the code cannot answer. Try to answer each question from the code first.
- **Size.** Use tables, one-line bullets, and anchors, not paragraphs. For diffs of more than 500 lines, the target is 25% or less of the reviewable diff lines.

## Other commands

- `diff-digest comments <md>`: print the open comments.
- `diff-digest note <md> "<target text>" "<body>"`: add an agent note to the block that contains the target text.
- `diff-digest export <md> --open`: write one static HTML file. It has no comments, and its anchors link to the GitHub remote at `head`. This is for sharing after the branch is pushed.
- `?live=0` on the URL: turn off live reload. Use this for headless screenshots.
- `#code=<path>:<start>-<end>` on the URL: open the code pane at those lines.
