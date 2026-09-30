# Digest format

A digest is a **change spec**. It is much smaller than the diff, and a reviewer can match every claim to the code.

**The test for a good digest:** give it and the base commit to a new agent of the same model class. That agent must be able to make a change that behaves the same way. The code does not need to be identical.

## Layout

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
- **Generated files.** Only list them. Never describe them. `hunks` marks these files as `generated`: lockfiles, snapshots, `__generated__/`, generated protos, and minified or map files. Also `.gitattributes` (`linguist-generated`, `linguist-vendored`) and the `generated` patterns in `~/.diff-digest/config.json`. Binary and LFS files are marked `binary`; list them the same way.
- **Do not mention** import changes, reordered code, or moved code that is otherwise identical.
- **Architecture diagram.** Show modules, components, stores, and data flow. Do not show functions. Keep it under 12 nodes. Mark the changed nodes and explain each one in one or two lines below the diagram. If the change touches only one module, leave the diagram out.
- **Changes.** One bullet for each change. Use this form: *what it was → what it is, and what moved where*, with anchors. Put renames here, not in a separate section.
- **Tables.** Use a table when the behavior depends on a combination of inputs. Use real cases as rows and columns, for example user role × page section. Do not use boolean formulas. Put the values as `before → after` in the cells, or in Before and After columns. Put ⚠️ where a user can see a change or where a change is not safe. Keep unchanged rows when they prove that behavior is equivalent.
- **Anchors.** Write each anchor as a code span: `path:line` or `path:start-end`. Use line numbers in the new file. A unique path suffix is enough. Anchors open in the code pane of the UI.
- **Tests.** For each added or changed test, give the behavior that it proves and why that case was chosen (a regression, an edge case, or an invariant). Put each ⚠️ behavior that has no test in Test gaps.
- **Questions.** Include only questions that the code cannot answer. Try to answer each question from the code first.
- **Size.** Use tables, one-line bullets, and anchors, not paragraphs. For diffs of more than 500 lines, the target is 25% or less of the reviewable diff lines.
