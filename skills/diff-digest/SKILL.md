---
name: diff-digest
description: Make or load a diff digest (a short Markdown change spec with a Mermaid diagram) for the current branch, a PR, another branch, a commit, or a range, and open it in a local review UI with a code pane and per-line comments. Loads the digest from a PR comment when one exists, and can post the digest or the collected comments to the PR. TRIGGER when the user runs /diff-digest, asks to digest, compact, or "make reviewable" a diff, or asks to review a PR, branch, or commit with a digest. DO NOT TRIGGER for a PR description only or a bug hunt.
argument-hint: "[pr-url | #pr | branch | commit | a..b]"
---

# Diff Digest

Run all commands from a clone of the repo. This skill needs the `diff-digest` command on `PATH`. If the command is missing, tell the user to run `bun run setup` in their diff-digest clone, and stop.

## 1. Resolve the target

Run `diff-digest target [<arg>]`. With no argument, the target is the current branch. The output gives:

| Field | Meaning |
|---|---|
| `kind` | `pr`, `branch`, `commit`, or `range` |
| `checkedOut` | `true` if the target's branch is the current branch. Then the head is the **working tree**, and uncommitted changes count. If `false`, the digest is **pinned** to the head commit, and you do not need to check anything out. |
| `base`, `head` | The commits. For a PR that is not checked out, `pull` gives `base`. |
| `pr` | The PR, if one exists |
| `digest`, `digestExists` | The digest path, and whether a local file exists there |

## 2. Get the digest

Use the first of these that applies:

1. **A local file exists** (`digestExists`): use it. Run `diff-digest check <md>`. If there are gaps, the code changed after the digest was written. Tell the user which hunks have no anchor, and offer to update the digest.
2. **A PR exists:** run `diff-digest pull <pr-url>`. It fetches the PR commits and looks for the digest comment. If `found` is true, the digest is written to `digest` (pinned if the branch is not checked out).
   - If `stale` is true, the PR has commits that the digest does not describe. Run `diff-digest check <md> --head <pr.headSha>` and tell the user which hunks have no anchor.
   - If `headMissing` is true, the digest's head commit is gone (force-push). Tell the user, and offer to generate a new digest.
3. **Otherwise, generate a digest:**
   - Run `diff-digest hunks --base <base>`, and add `--head <head>` if the target is not checked out. `hunks` sorts files into `source`, `test`, `generated`, and `binary` (from `.gitattributes`, then built-in patterns), and removes import-only and moved-code hunks.
   - Read the source and test hunks with `git diff --no-ext-diff <base> [<head>] -- <path>`. Do not read generated or binary files.
   - Run `diff-digest format` and obey it exactly. In the diagram, number each changed node (①②③) and use the same numbers in the list below it and in the Changes bullets. Write the digest to `digest`. The frontmatter has `branch`, `base`, and `head` (full SHAs); `pr: <url>` if a PR exists; and `pinned: true` if the target is not checked out.
   - Run `diff-digest check <md>` and fix every gap. Before you write a claim such as "no code reads X", verify it with `grep`.
   - The digest has no Questions section. For each question that the code cannot answer, run `diff-digest note <md> "<text from the related block>" "Q: <question>"`.
   - If a PR exists, ask the user one question (AskUserQuestion): *post the digest to PR #N*, or *keep it local*. Before you post from the working tree, make sure that the branch is pushed and that `head` is the PR's head commit. To post, run `diff-digest publish <md>`. If no PR exists, do not ask.

## 3. Serve

Start two background tasks with `run_in_background: true` and `timeout: 7200000`:

- `diff-digest serve <md> --open`. This keeps running. Start it only once.
- `diff-digest wait <md>`. This exits when the user clicks a button, and the exit wakes you.

Tell the user the URL, the PR comment URL if you posted, and how many questions you added as notes. Then stop and wait.

In the UI, the user comments on digest blocks and code lines, then uses one of these buttons:

| Button | Who does it |
|---|---|
| **Apply comments** | You (see below). |
| **Review with agent** | You (see below). |
| **Post comments…** (with a PR) | The UI. The user previews the comments as one Markdown comment, then posts it. |
| **Post digest** (with a PR) | The UI, after the user confirms. |
| **Mark generated** (code pane **⋯** menu) | The UI. It writes the file's path to this repo's `generated` list in `~/.diff-digest/config.json`. `hunks` and `check` skip the file from then on. If the digest describes that file, offer to remove that part. |

## 4. When `wait` exits

The output starts with `ACTION: <type>`, followed by JSON that contains the open comments. A code comment on a range has `line` and `endLine`, and its `text` has all the lines in the range.

- **`apply`**: act on each comment, then run `diff-digest resolve <md> <id> "<one-line reply>"`.
  - The digest is wrong, unclear, or incomplete: edit the digest, then run `check` again.
  - A question about the code: answer it from the code in the reply.
  - A code change: make it on the target branch. If the branch is not checked out here, ask the user before you check it out or make a worktree. Do not push unless the user tells you to.
  - If you changed a digest that is posted to the PR, ask the user whether to post it again.
- **`review`**: start a **new** agent with the Agent tool. Use `subagent_type: general-purpose`, do not use a fork, and do not set a model. Its prompt is the output of `diff-digest prompt review-agent`, with these placeholders filled in: `{{WORKTREE}}`, `{{BASE}}`, `{{HEAD}}` (`working tree` if checked out), `{{DIGEST}}`, `{{REF_ARGS}}` (`<ref> [--base <base>]`: the branch, commit, or range of the digest, plus `--base <base>` when the base is not the default base), and `{{RANGE}}` (`<base>`, plus `<head>` if pinned). When it finishes, run `check` and give the user a short summary.
- **`timeout`** or **`error`**: if the server is not running, start it again.

After each action, start `wait` again. The page reloads by itself when the digest or the comments change.

## Other commands

- `diff-digest config`: show the settings for this repo (digest folder, extra generated patterns). The file is `~/.diff-digest/config.json`. If a generated file shows as `source`, suggest that the user click **Mark generated** in the file tree, or add a pattern in the config. Do not edit the file unless the user asks.
- `diff-digest comments <md>`: print the open comments.
- `diff-digest note <md> "<target text>" "<body>"`: add an agent note to the block that contains the target text.
- `diff-digest review-md <md>`: print the open comments as one Markdown comment. Post it only if the user asks.
- `diff-digest publish <md> --dry-run`: print the digest comment body, and post nothing.
- `diff-digest pull <pr> --force`: replace an existing local digest with the PR's digest comment.
- `diff-digest export <md> --open`: write one static HTML file whose anchors link to the remote.
- `?live=0` on the URL turns off live reload (for headless screenshots). `#code=<path>:<start>-<end>` opens the code pane at those lines.
