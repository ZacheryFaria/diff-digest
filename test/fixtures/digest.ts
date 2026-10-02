// A digest body that passes every lint rule. Tests change one part of it at a time.
export const GOOD_BODY = `
# Retry failed API calls

- **Size:** 25 digest lines for 40 reviewable diff lines in 1 commit.
- **What it does:** A failed API call is tried two more times: \`src/api.ts:10-14\`

**Generated (not reviewed):** \`bun.lock\`

## Architecture

\`\`\`mermaid
flowchart LR
  api["① API client"]:::changed --> store[(Store)]
  store --> view["② List view"]:::changed
  classDef changed stroke:#ffc430,stroke-width:2px
\`\`\`

1. ① The client retries a failed call two times: \`src/api.ts:1-20\`
2. ② The list shows a retry badge: \`src/badge.tsx:1-5\`

## Changes

- ① \`fetchItems()\` is now \`fetchItems({ retries: 2 })\`: \`src/api.ts:10-14\`
- ② The badge renders when \`retried\` is true: \`src/view.tsx:3\`

## Tests

| Test | Proves | Why this case |
|---|---|---|
| retries twice \`test/api.test.ts:5\` | The third failure is final | Edge case |
`;

export const FRONTMATTER = `---
id: k3f9a0b2
branch: zf/retry
base: ${"a".repeat(40)}
head: null
pinned: false
meta: {}
---
`;
