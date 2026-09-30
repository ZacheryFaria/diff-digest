# diff-digest

This tool makes a git diff into a short **change spec** (Markdown) that a person can review. The spec goes in a PR comment. A local UI shows the spec beside the code, collects comments, and sends them back to a Claude Code session.

The test for a good digest: give the digest and the base commit to a new agent of the same model class. That agent must be able to make a change that behaves the same way. The code does not need to be identical.

## Use

Run `/diff-digest [pr-url | #pr | branch | commit | a..b]` in Claude Code. With no argument, the target is the current branch.

1. **Code.** If the target's branch is checked out, the digest reads the working tree, so uncommitted changes count. If it is not, the digest is pinned to the head commit, and you do not need to check it out.
2. **Digest.** Claude uses a local digest if one exists. If not, it pulls the digest from the PR comment. If there is none, it generates one and asks whether to post it to the PR (if one exists). A digest that is older than the code gets a warning, with a list of the hunks that it does not explain.
3. **UI.** Comment on digest blocks and code lines, then do one of these:
   - **Apply comments**: Claude acts on them now. It edits the digest, answers questions, or changes code (it asks before it checks out a branch).
   - **Post comments…** (with a PR): preview and edit the comments as one Markdown comment, then post it.
   - **Post digest** (with a PR): post or update the digest comment.
   - **Review with agent**: a new agent checks the digest against the code and edits it.

So the author runs `/diff-digest` on their branch, and a reviewer runs `/diff-digest <pr-url>`.

## What is in a digest

- **Generated files**: listed only.
- **Architecture**: a Mermaid diagram of modules and data flow. Changed nodes are marked and have short notes.
- **Changes**: one line for each change, in the form *what it was → what it is*, with `file:line` anchors.
- **Tables**: behavior as `before → after` for each real case. ⚠️ marks a change that a user can see or that is not safe.
- **Tests and test gaps**: what each test proves and why that case was chosen. Changed behavior that has no test.
- **Questions**: only questions that the code cannot answer.

The full rules are in [`docs/format.md`](docs/format.md) (`diff-digest format` prints them).

### On GitHub

`publish` posts the digest as one PR comment. If a digest comment already exists, `publish` updates it. The comment starts with a hidden `<!-- diff-digest: … -->` marker that holds the base and head SHAs, and each anchor becomes a link to the head commit. `pull` reverses these changes, so a pulled digest has the same body as the original. The comment limit is 65,536 characters.

### Generated and binary files

`hunks` and `check` skip these files, and the digest only lists them:

1. `.gitattributes`: `linguist-generated` or `linguist-vendored` marks a file as generated, and `filter=lfs` marks it as binary. `linguist-generated=false` has no effect here, because it only changes GitHub's diff view.
2. Files that git shows as binary.
3. Built-in patterns: lockfiles, snapshots, `__generated__/`, generated protos, and minified or map files.
4. The `generated` regexes in `~/.diff-digest/config.json` (see Configuration).

## Install

Requirements: [Bun](https://bun.sh) 1.1 or later, git, a browser, and the [`gh`](https://cli.github.com) CLI logged in to your host for the PR features. The UI loads `marked`, `mermaid`, and `highlight.js` from jsDelivr, so it needs network access. The tool has no package dependencies.

```bash
git clone <this repo> ~/sources/diff-digest
cd ~/sources/diff-digest
bun run setup
```

`setup` copies the tool into `~/.diff-digest/lib/`, writes the `diff-digest` command to `~/.local/bin/`, and copies the skill into `~/.claude/skills/diff-digest/`. It also writes `~/.diff-digest/config.json` if that file does not exist. Nothing is linked, so edits in the clone have no effect until you run `bun run setup` again.

| Option | Effect |
|---|---|
| `--bin-dir <dir>` | Write the command to another folder. It must be on your `PATH`. |
| `--skills-dir <dir>` | Copy the skill to another Claude Code skills folder. |
| `--force` | Replace a command or skill folder that `setup` did not make. |
| `--uninstall` | Remove the tool, the command, and the skill. The config and the digests stay. |

## The UI

| Do this | Result |
|---|---|
| Click an anchor | The file opens beside the digest in the **Diff** tab, with the anchored hunk marked. **After** and **Before** show the full file. |
| Hover a line and click **+** | Adds a comment on a digest block, a diff line, or a file line. |
| **Apply comments** | The Claude session acts on your open comments and replies to each one. |
| **Review with agent** | A new agent with no context reads the code first, then checks the digest and edits it. |
| **Post comments…** | Shows your open comments as one Markdown comment. You can edit it, copy it, or post it to the PR. |
| **Post digest** | Posts or updates the digest comment on the PR, after you confirm. |

The dot at the top right shows whether a Claude session is waiting for a click. If no session is waiting, the click is queued until one is.

A Claude Code hook cannot wake an idle session, but a background task that exits does wake it. So Claude runs `diff-digest wait` in the background. It blocks until you click a button, then it exits and prints your comments.

## CLI

Run these commands from the repo or worktree.

| Command | Purpose |
|---|---|
| `diff-digest target [<arg>]` | Resolve a PR, branch, commit, or range to its base, head, PR, and digest path. |
| `diff-digest path [--name <n>]` | Print the digest path for the current branch. |
| `diff-digest hunks [--base <ref>] [--head <ref>]` | Sort changed files by class and list the reviewable hunks. |
| `diff-digest check <md> [--head <ref>]` | Fail if a reviewable hunk has no anchor. |
| `diff-digest serve <md> [--port N] [--open]` | Run the review UI. |
| `diff-digest wait <md>` | Block until you click a button, then print the action. |
| `diff-digest publish <md> [--pr <pr>] [--dry-run]` | Post or update the digest comment on the PR. |
| `diff-digest pull <pr> [--force]` | Fetch the PR commits and its digest comment, and write the digest (pinned if the branch is not checked out). |
| `diff-digest review-md <md>` | Print your open comments as one Markdown comment. |
| `diff-digest comments` / `resolve` / `note` | Read and update comments. |
| `diff-digest export <md> [--open]` | Write one static HTML file whose anchors link to the remote. |
| `diff-digest config [--init]` | Show the settings for the current repo. `--init` writes the config file if it does not exist. |
| `diff-digest format` / `prompt review-agent` | Print the format rules or the review-agent prompt. |

If you do not give `--base`, the base is the merge-base with the remote default branch. Without `--head`, or `pinned: true` in the frontmatter, the head is the working tree.

## Configuration

`~/.diff-digest/config.json` holds global settings, and settings for each repo under `repos`. A repo entry matches the repo name or `host/owner/name` of the `origin` remote. Its `generated` list is added to the global list, and its `digestDir` replaces the global one.

```json
{
  "generated": ["\\.g\\.dart$"],
  "digestDir": "~/.diff-digest/digests/{repo}",
  "repos": {
    "my-monorepo": {
      "generated": ["(^|/)BUILD\\.bazel$"],
      "digestDir": "~/work/my-monorepo/.notes/digests"
    }
  }
}
```

| Key | Effect |
|---|---|
| `generated` | Regexes, tested against the repo-relative path, for more generated files. |
| `digestDir` | The folder for digests. `{repo}` is the repo name, and `~` is your home folder. The default is `~/.diff-digest/digests/<repo>/`. |

`diff-digest config` shows the settings for the current repo. `DIFF_DIGEST_HOME` moves the `~/.diff-digest` folder, for example for tests.

## Layout

```
bin/diff-digest.mjs        CLI and server (Bun, no dependencies)
scripts/install.mjs        `bun run setup`
ui/                        browser UI (index.html, app.js, styles.css)
docs/format.md             digest format and rules
prompts/review-agent.md    prompt for "Review with agent"
skills/diff-digest/        the Claude Code skill
```

Next to each digest, the server writes `<name>.comments.json` and `<name>.server.json`.
