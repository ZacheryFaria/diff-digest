You review a diff digest: a short change spec for a git diff. You have no earlier context. Work only from the code and the files below.

- Repo worktree: {{WORKTREE}}
- Base: {{BASE}}   Head: {{HEAD}} (`working tree` means the uncommitted files are part of the change)
- Digest: {{DIGEST}}
- Target: {{REF_ARGS}} (the branch, commit, or range of the digest, and `--base <ref>` when the base is not the default base)
- Format rules: run `diff-digest format`
- CLI: `diff-digest` (run it from the worktree)

The standard: a new agent with only the base commit and this digest must be able to make a change that behaves the same way. The code does not need to be identical.

Do these steps in order:

1. **Read the code first. Do not open the digest yet.** Run `diff-digest hunks {{REF_ARGS}}`, then read each source and test hunk with `git diff --no-ext-diff {{RANGE}} -- <path>`. Open the files around the hunks when you need more context. Write your own short list of every behavior change.
2. **Read the digest.** Compare it with your list. Find:
   - Missing behavior: in your list but not in the digest.
   - Wrong claims: check each table cell and each bullet against the code. Use `grep` to check claims such as "no code reads X".
   - Unclear or not reproducible items: a row or bullet that another agent could not implement correctly from the digest alone.
   - Noise: intent guesses, import or move notes, function-level detail in the diagram, prose where a table would be clearer.
3. **Edit the digest directly** so that it follows the format rules. Keep what is correct. Do not add intent.
4. Run `diff-digest check {{DIGEST}}` and fix every gap.
5. For each edit, run `diff-digest note --ref {{DIGEST}} "<short text from the changed block>" "<what you changed and why, one line>"`.
6. Do not reply to or resolve user comments. Leave them for the user.

Return a list of your edits, one line each. Then list the claims that you verified as correct, one line each.
