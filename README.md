# diff-digest

This tool makes a git diff into a short **change spec** that a person can review. It also gives a local review UI where you can comment on the spec and on the code, and send the comments back to a Claude Code session.

The test for a good digest: give the digest and the base commit to a new agent of the same model class. That agent must be able to make a change that behaves the same way. The code does not need to be identical.

## What is in a digest

- **Generated files** (lockfiles, snapshots, generated code): listed only.
- **Architecture**: a Mermaid diagram of modules and data flow. Changed nodes are marked and have short notes.
- **Changes**: one line for each change, in the form *what it was → what it is*, with `file:line` anchors.
- **Tables**: behavior as `before → after` for each real case. ⚠️ marks a change that a user can see or that is not safe.
- **Tests and test gaps**: what each test proves and why that case was chosen. Changed behavior that has no test.
- **Questions**: only questions that the code cannot answer.

The digest has no intent section. It does not mention imports or moved code that is otherwise identical. The full format is in [`skills/diff-digest/SKILL.md`](skills/diff-digest/SKILL.md).

## Install

Requirements: Node 20 or later, git, and a browser. The UI loads `marked`, `mermaid`, and `highlight.js` from jsDelivr, so it needs network access. The CLI has no dependencies.

```bash
git clone <this repo> ~/sources/diff-digest
cd ~/sources/diff-digest
npm link                                                  # puts `diff-digest` on PATH
ln -s "$PWD/skills/diff-digest" ~/.claude/skills/diff-digest
```

If you do not want to use `npm link`, link the file yourself: `ln -s "$PWD/bin/diff-digest.mjs" ~/.local/bin/diff-digest`.

## Use

In a Claude Code session in a repo, run `/diff-digest`, or ask Claude to "digest this branch". Claude then:

1. Writes the digest to the path that `diff-digest path` prints. The default is `~/.diff-digest/<repo>/<branch>.md`.
2. Runs `diff-digest check`. Each reviewable hunk must have an anchor. Import-only hunks and moved code are ignored.
3. Starts `serve` and `wait` in the background, and opens the UI.

In the UI:

| Do this | Result |
|---|---|
| Click an anchor | The file opens beside the digest in the **Diff** tab, with the anchored hunk marked. The **After** and **Before** tabs show the full file. |
| Hover a line and click **+** | Adds a comment. You can comment on any digest block, any diff line, or any file line. |
| **Apply comments** | Claude edits the digest to address each comment, then replies to it. The page reloads by itself. |
| **Review with agent** | A new agent with no context reads the code first, then checks the digest against it. It edits the digest and adds notes. |

The dot at the top right shows whether a Claude session is waiting for a click. If no session is waiting, the click is queued until one is.

### Why a background `wait` task and not a hook

A Claude Code hook cannot wake an idle session. A background task that exits does wake it. `wait` blocks until you click a button, then it exits and prints the comments. Claude does the work and starts `wait` again.

## CLI

Run these commands from the repo or worktree.

| Command | Purpose |
|---|---|
| `diff-digest path` | Print the default digest path for the current branch. |
| `diff-digest hunks [--base <ref>]` | Sort changed files by class and list the reviewable hunks. |
| `diff-digest check <md>` | Fail if a reviewable hunk has no anchor. |
| `diff-digest serve <md> [--port N] [--open]` | Run the review UI. |
| `diff-digest wait <md>` | Block until you click a button, then print the action. |
| `diff-digest comments <md>` | Print the open comments. |
| `diff-digest resolve <md> <id> "<reply>"` | Mark a comment as resolved. |
| `diff-digest note <md> "<target text>" "<body>"` | Add an agent note. |
| `diff-digest export <md> [--open]` | Write one static HTML file that links to the remote (no comments). |

If you do not give `--base`, the base is the merge-base with `origin/main` or `origin/master`.

URL options: `?live=0` turns off live reload (for headless screenshots). `#code=<path>:<start>-<end>` opens the code pane at those lines.

## Configuration

| Variable | Effect |
|---|---|
| `DIFF_DIGEST_DIR` | The folder for digests. The default is `~/.diff-digest/<repo>/`. |
| `DIFF_DIGEST_GENERATED` | More regexes for generated files, comma-separated. They are added to the built-in list. Example: `(^\|/)BUILD\.bazel$,\.g\.dart$` |

## Layout

```
bin/diff-digest.mjs     CLI and server (Node built-ins only)
ui/                     browser UI (index.html, app.js, styles.css)
skills/diff-digest/
  SKILL.md              instructions and format rules for Claude
  review-prompt.md      prompt for the "Review with agent" agent
```

Next to each digest, the server writes `<name>.comments.json` and `<name>.server.json`.
