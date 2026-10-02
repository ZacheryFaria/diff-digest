---
name: diff-digest
description: Make or load a diff digest (a short Markdown change spec with a Mermaid diagram) for the current branch, a PR, another branch, a commit, or a range, and open it in a local review UI with a code pane and per-line comments. Loads the digest from a backend (a PR comment, or a local notes folder) when one has it, and can publish the digest or the collected comments. TRIGGER when the user runs /diff-digest, asks to digest, compact, or "make reviewable" a diff, or asks to review a PR, branch, or commit with a digest. DO NOT TRIGGER for a PR description only or a bug hunt.
argument-hint: "[pr-url | #pr | branch | commit | a..b]"
---

# Diff Digest

Run all commands from a clone of the repo. This skill needs the `diff-digest` command on `PATH`. If the command is missing, tell the user to run `bun run setup` in their diff-digest clone, and stop.

Each command takes the target as `[ref]`: nothing (the current branch), a branch, a commit, a range `a..b`, a PR (`#123` or a PR URL), or the digest `.md` path. `resolve`, `note`, and `mark` take it as `--ref <ref>`. Add `--json` to get `{ ok, data }` or `{ ok: false, error: { code, message, hint } }`. Run `diff-digest schema <command>` for the JSON schema of a result.

The tool owns the frontmatter (`id`, `branch`, `base`, `head`, `pinned`, `meta`), the comments, and the config. You write only the Markdown body. Do not edit the frontmatter.

## 1. Resolve the target

Run `diff-digest target [<ref>] --json`:

| Field | Meaning |
|---|---|
| `kind` | `pr`, `branch`, `commit`, or `range` |
| `checkedOut` | `true` if the target's branch is the current branch. Then the head is the **working tree**, and uncommitted changes count. If `false`, the digest is **pinned** to the head commit, and you do not need to check anything out. |
| `base`, `head` | The commits |
| `pr` | The PR, if one exists |

`diff-digest path [<ref>]` prints the working copy path (in `~/.diff-digest/store/`). The file can be missing.

## 2. Get the digest

Use the first of these that applies:

1. **The working copy exists** (the file at `path`): use it. Run `diff-digest check [<ref>]`. If there are gaps, the code changed after the digest was written. Tell the user which hunks have no anchor, and offer to update the digest.
2. **A backend has the digest:** run `diff-digest pull [<ref>] --json`. It tries each backend in `publishTo` (a PR comment for `github`, a file for `local`). For a PR, it fetches the PR commits first.
   - `stale: true`: the target has commits that the digest does not describe. Run `diff-digest check [<ref>]` and tell the user which hunks have no anchor.
   - `headMissing: true`: the digest's head commit is gone (force-push). Tell the user, and offer to generate a new digest.
   - The error code `NOT_FOUND`: no backend has the digest. Go to step 3.
3. **Otherwise, generate a digest:**
   - Run `diff-digest init [<ref>]`. It writes the working copy with its frontmatter and prints the path. Add `--base <ref>` when the user asks for another base.
   - Run `diff-digest hunks [<ref>]`. It sorts the files into `source`, `test`, `generated`, and `binary` (from `.gitattributes`, the config, and built-in patterns), and removes import-only and moved-code hunks.
   - Read the source and test hunks with `git diff --no-ext-diff <base> [<head>] -- <path>`. Do not read generated or binary files.
   - Run `diff-digest format` and obey it. The main rule: **every line maps to code**, so each note, bullet, and table row has an anchor (or a parent bullet or `###` heading has one). In the diagram, number each changed node (①②③) and use the same numbers in the list below it (each note with an anchor) and in the Changes bullets. Below the title, write the summary: **What it does**, **New modules**, **Changes you can see**, with anchors. Write the body below the frontmatter.
   - Run `diff-digest fmt [<ref>]` (safe fixes; it also writes the summary's **Size** line from the diff), then `diff-digest check [<ref>]`. Fix every lint error (exit 5) and every coverage gap (exit 6), and the `maps-to-code` and `summary` warnings. Before you write a claim such as "no code reads X", verify it with `grep`.
   - The digest has no Questions section. For each question that the code cannot answer, run `diff-digest note --ref <ref> "<text from the related block>" "Q: <question>"`.
   - If a backend can take the digest (for `github`, a PR exists), ask the user one question (AskUserQuestion): *publish the digest*, or *keep it local*. Before you publish from the working tree, make sure that the branch is pushed. To publish, run `diff-digest publish [<ref>]`. `--dry-run` shows the body and posts nothing.

## 3. Serve

1. Run `diff-digest serve [<ref>] --open`. It starts the background server if it is not running, opens the page, and prints the URL. The command exits at once; the server keeps running.
2. Start `diff-digest wait [<ref>]` as a background task (`run_in_background: true`, `timeout: 7200000`). It exits when the user clicks a button, and the exit wakes you.

Reply to the user with the digest's summary block (Size, What it does, New modules, Changes you can see), the URL, the published URL if you published, and how many questions you added as notes. Then stop and wait.

In the UI, the user comments on digest blocks, table rows, and code lines (drag from **+** for a range), then uses one of these buttons:

| Button | Who does it |
|---|---|
| **Apply comments** | You (see below). |
| **Review with agent** | You (see below). |
| **Post comments…** | The UI. The user previews the open comments as one Markdown review, chooses the backends, and posts it. |
| **Publish…** | The UI. The user chooses the backends, previews, and publishes. |
| **Mark generated** (code pane **⋯** menu) | The UI. It adds the file to this repo's `generated` list in `~/.diff-digest/config.json`. `hunks` and `check` skip the file from then on. If the digest describes that file, offer to remove that part. |

## 4. When `wait` exits

The output starts with `ACTION: <type>`, followed by JSON with `id`, `mdPath`, and `comments` (the open user comments). A code comment on a range has `line` and `endLine`, and its `text` has all the lines in the range.

- **`apply`**: act on each comment, then run `diff-digest resolve --ref <ref> <comment-id> "<one-line reply>"`.
  - The digest is wrong, unclear, or incomplete: edit the body, then run `fmt` and `check` again.
  - A question about the code: answer it from the code in the reply.
  - A code change: make it on the target branch. If the branch is not checked out here, ask the user before you check it out or make a worktree. Do not push unless the user tells you to.
  - If you changed a digest that is published, ask the user whether to publish it again.
- **`review`**: start a **new** agent with the Agent tool. Use `subagent_type: general-purpose`, do not use a fork, and do not set a model. Its prompt is the output of `diff-digest prompt review-agent`, with these placeholders filled in: `{{WORKTREE}}`, `{{BASE}}`, `{{HEAD}}` (`working tree` if checked out), `{{DIGEST}}` (the `.md` path), `{{REF_ARGS}}` (the target ref, plus `--base <ref>` if the digest has a non-default base), and `{{RANGE}}` (`<base>`, plus `<head>` if pinned). When it finishes, run `check` and give the user a short summary.
- **`timeout`**: start `wait` again. If `wait` fails with `SERVER_DOWN` (exit 11), run `serve` again.

After each action, start `wait` again. The page reloads by itself when the digest or the comments change.

## Other commands

- `diff-digest config`: show the settings for this repo (`publishTo`, the backends, extra generated patterns). The file is `~/.diff-digest/config.json`. If a generated file shows as `source`, suggest that the user click **Mark generated**, or run `diff-digest mark --ref <ref> <path>`. Do not edit the config unless the user asks.
- `diff-digest comments [<ref>]`: print the open comments. `--markdown` prints them as one Markdown review. `--publish [--to <backends>]` posts that review. Post only if the user asks.
- `diff-digest lint [<ref>]`: only the format rules, without coverage.
- `diff-digest export [<ref>] --open`: write one static HTML file whose anchors link to the repo web page.
- `diff-digest server status | stop | restart | logs [-f]`: the background server.
- `?live=0` on the URL turns off live reload (for headless screenshots). `#code=<path>:<start>-<end>` opens the code pane at those lines.
