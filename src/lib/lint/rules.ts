// The lint rules, in the order that `format` prints them.
import { anchorResolves, linkStyle, noInlineHtml, noIntent, noWikilinks, tableMaxColumns } from "./content";
import { changedNodeMarked, diagramNotes, diagramSize, nodeNumbers } from "./diagram";
import { frontmatter } from "./frontmatter";
import { mapsToCode, summary } from "./mapping";
import type { LintRule } from "./rule";
import { noQuestions, sectionOrder, unknownSection } from "./structure";

export { INTENT_PHRASES, MAX_TABLE_COLUMNS } from "./content";
export { MAX_DIAGRAM_NODES } from "./diagram";
export { MAPPED_SECTIONS, SIZE_LABEL, SUMMARY_LABELS } from "./mapping";
export { KNOWN_SECTIONS } from "./structure";

export const RULES: readonly LintRule[] = [
    frontmatter,
    anchorResolves,
    mapsToCode,
    summary,
    nodeNumbers,
    changedNodeMarked,
    diagramNotes,
    diagramSize,
    sectionOrder,
    unknownSection,
    noQuestions,
    noIntent,
    noInlineHtml,
    noWikilinks,
    linkStyle,
    tableMaxColumns,
];
