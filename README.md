# diff-digest

This tool makes a git diff into a short **change spec** (Markdown) that a person can review. A local UI shows the spec beside the code, collects comments, and sends them back to a Claude Code session. You can publish the spec to a PR comment or to a local notes folder (for example an Obsidian vault). Any Markdown viewer shows it correctly: GitHub, GitLab, glow, and Obsidian.

The test for a good digest: give the digest and the base commit to a new agent of the same model class. That agent must be able to make a change that behaves the same way. The code does not need to be identical.

## Use

Run `/diff-digest [pr-url | #pr | branch | commit | a..b]` in Claude Code. With no argument, the target is the current branch.

1. **Code.** If the target's branch is checked out, the digest reads the working tree, so uncommitted changes count. If it is not, the digest is pinned to the head commit, and you do not need to check it out.
2. **Digest.** Claude uses the local working copy if one exists. If not, it pulls the digest from a backend (the PR comment, or the notes folder). If there is none, it generates one, and asks whether to publish it. A digest that is older than the code gets a warning, with a list of the hunks that it does not explain.
3. **UI.** Comment on digest blocks, table rows, and code lines, then do one of these:
   - **Apply comments**: Claude acts on them now. It edits the digest, answers questions, or changes code (it asks before it checks out a branch).
   - **Review with agent**: a new agent checks the digest against the code and edits it.
   - **Post comments…**: preview your open comments as one Markdown review, choose the backends, and post it.
   - **Publish…**: choose the backends, preview, and publish the digest.

So the author runs `/diff-digest` on their branch, and a reviewer runs `/diff-digest <pr-url>`.

## What is in a digest

- **Generated files**: listed only.
- **Architecture**: a Mermaid diagram of modules and data flow. Each changed node has a number (①②③). The notes below the diagram and the Changes bullets use the same numbers.
- **Changes**: one line for each change, in the form *what it was → what it is*, with `file:line` anchors.
- **Tables**: behavior as `before → after` for each real case. ⚠️ marks a change that a user can see or that is not safe.
- **Tests and test gaps**: what each test proves and why that case was chosen. Changed behavior that has no test.

Questions that the code cannot answer are not in the digest. Claude adds them as agent notes on the related blocks, so you see them in the UI, and they are not published.

`diff-digest format` prints the format and the lint rules. Agents write the Markdown; the tool owns the frontmatter, the comments, and the config, and it lints the Markdown (`lint`, `check`) and applies safe fixes (`fmt`). All valid CommonMark + GFM is allowed. The rules are for best practice.

## Install

Requirements: [Bun](https://bun.sh) 1.4.2 or later (only to build), git, a browser, and the [`gh`](https://cli.github.com) CLI logged in to your host for the `github` backend. The binary has no runtime dependencies and loads nothing from the network.

```bash
git clone <this repo> ~/sources/diff-digest
cd ~/sources/diff-digest
bun install
bun run setup
```

`setup` builds one binary (`dist/diff-digest`, with the UI inside), copies it to `~/.local/bin/diff-digest`, and copies the skill into `~/.claude/skills/diff-digest/`. It removes the old tool in `~/.diff-digest/lib/` if it finds it. Run `bun run setup` again after you change the clone.

| Option | Effect |
|---|---|
| `--bin-dir <dir>` | Copy the binary to another folder. It must be on your `PATH`. |
| `--skills-dir <dir>` | Copy the skill to another Claude Code skills folder. |
| `--force` | Replace a command or skill folder that `setup` did not make. |
| `--uninstall` | Remove the command and the skill. The config and the store stay. |

## The UI

| Do this | Result |
|---|---|
| Click a file in the **Files** tree | The file's diff opens in the code pane. |
| In the code pane, click **⋯** → **Mark generated** | Future digests list the open file as generated and do not describe it. **Unmark generated** reverses this. |
| Click an anchor | The file opens beside the digest in the **Diff** tab, with the anchored hunk marked. **After** and **Before** show the full file. If the file did not change, the pane shows the full file with an "unchanged" tag. |
| Hover a block, a table row, or a line, and click **+** | Adds a comment. In the code pane, drag from **+** to another line to comment on a range. A range stays on one side (before or after). |

The dot at the top right shows whether a Claude session is waiting for a click. If no session is waiting, the click is queued until one is.

A Claude Code hook cannot wake an idle session, but a background task that exits does wake it. So Claude runs `diff-digest wait` in the background. It blocks until you click a button, then it exits and prints your comments.

The server runs in the background. `serve` starts it when it is not running, and it stops after 4 hours with no use. There are no system services. `diff-digest server status | stop | restart | logs [-f]` manage it.

## CLI

Run `diff-digest --help`, or `diff-digest <command> --help`. Each command takes the target as `[ref]`: nothing (the current branch), a branch, a commit, a range `a..b`, a PR (`#123` or a URL), or the digest `.md` path. Each command has `--json`, and `diff-digest schema <command>` prints the JSON schema of its result.

| Group | Commands |
|---|---|
| Targets | `target`, `init [--base]`, `path`, `hunks [--base]` |
| Format | `lint`, `check`, `fmt [--check] [--questions-to-notes]`, `format` |
| Comments | `comments [--status] [--markdown] [--publish]`, `resolve`, `note`, `mark [--off]` |
| UI | `serve [--open]`, `wait [--timeout]`, `export [--out] [--open]` |
| Backends | `publish [--to] [--dry-run] [--force]`, `pull [--from] [--force]` |
| Other | `server …`, `prompt review-agent`, `config [--init]`, `schema [--openapi]` |

If you do not give `--base`, the base is the merge-base with the remote default branch. In a repo that has no commits, the base is the empty tree. The working tree includes untracked files that `.gitignore` does not exclude.

| Exit | Code | Exit | Code |
|---|---|---|---|
| 0 | OK | 8 | `NO_BACKEND` |
| 2 | usage error | 9 | `BACKEND_FAILED` |
| 3 | `BAD_INPUT` | 10 | `BAD_CONFIG` |
| 4 | `NOT_FOUND` | 11 | `SERVER_DOWN` |
| 5 | `LINT_FAILED` | 12 | `GIT_FAILED` |
| 6 | `COVERAGE_GAP` | 13 | `LOCKED` |
| 7 | `STALE` | 70 | `INTERNAL` |

With `--json`, an error has a `code`, a `message`, and often a `hint`.

## Configuration

`~/.diff-digest/config.json` holds global settings, and settings for each repo under `repos`. A repo entry matches the repo name or `host/owner/name` of the `origin` remote.

```json
{
  "backends": {
    "github": { "type": "github" },
    "notes": {
      "type": "local",
      "dir": "~/vault/digests/{repo}",
      "linkTemplate": "vscode://file/{root}/{path}:{start}",
      "frontmatter": { "tags": ["digest"] }
    }
  },
  "publishTo": ["github", "notes"],
  "generated": ["\\.g\\.dart$"],
  "repos": {
    "my-monorepo": { "generated": ["(^|/)BUILD\\.bazel$"], "publishTo": ["notes"] }
  }
}
```

| Key | Effect |
|---|---|
| `backends` | Named backends. `github` posts one PR comment with a hidden `<!-- diff-digest: … -->` marker, and links anchors to the head commit (limit: 65,536 characters). `local` writes `<dir>/<name>.md` and `<dir>/<name>.review.md` with YAML frontmatter. `dir` takes `{repo}` and `{branch}`. `linkTemplate` takes `{root}`, `{path}`, `{start}`, `{end}`, and `{sha}`; with no template, anchors stay code spans. |
| `publishTo` | The backends for `publish`, `pull`, and `comments --publish` when you give no `--to` / `--from`. The default is `["github"]`. |
| `generated` | Regexes, tested against the repo-relative path, for more generated files. A repo's list is added to the global list. **Mark generated** writes `^<path>$` to the repo entry. |

`diff-digest config` shows the settings for the current repo. `DIFF_DIGEST_HOME` moves the `~/.diff-digest` folder, for example for tests. Working copies and their comments are in `~/.diff-digest/store/`.

### Generated and binary files

`hunks` and `check` skip these files, and the digest only lists them:

1. `.gitattributes`: `linguist-generated` or `linguist-vendored` marks a file as generated, and `filter=lfs` marks it as binary.
2. Files that git shows as binary.
3. Built-in patterns: lockfiles, snapshots, `__generated__/`, generated protos, and minified or map files.
4. The `generated` regexes in the config.

## Development

`bun run verify` runs the type check, the lint (oxlint with type-aware rules, the suppression check, Prettier), and the tests. `bun run dev` runs the server with hot reload. `bun run build` builds `dist/diff-digest`. The design is in `docs/superpowers/specs/2026-09-30-typescript-rewrite-design.md`.

```
src/cli/      the Stricli commands
src/server/   the background server (oRPC over Bun.serve)
src/app/      the React UI
src/lib/      the shared code: schemas, git, digest, lint, fmt, backends
skills/       the Claude Code skill
docs/         the format doc, the spec, and the plans
scripts/      build, setup, and the suppression check
```
