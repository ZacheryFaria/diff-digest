import { issue, type LintRule } from "./rule";

export const frontmatter: LintRule = {
    id: "frontmatter",
    severity: "error",
    description: "The frontmatter matches the schema.",
    check: ({ frontmatterError }) => (frontmatterError === null ? [] : [issue(frontmatter, 1, frontmatterError)]),
};
