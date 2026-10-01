// Markdown files imported as text (`import x from "./a.md" with { type: "text" }`).
declare module "*.md" {
    const text: string;
    export default text;
}
