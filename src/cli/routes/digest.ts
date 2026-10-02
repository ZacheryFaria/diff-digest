// Commands that make, check, and fix a digest. Each command loads its code when it runs (spec §12).
import { buildCommand } from "@stricli/core";
import { baseFlag, idFlag, jsonFlag, refPositional } from "../commands/shared";

const refFlags = { json: jsonFlag, id: idFlag } as const;

export const digestRoutes = {
    target: buildCommand({
        docs: { brief: "Show the base, head, and working copy name for a target" },
        parameters: { flags: { json: jsonFlag }, positional: refPositional },
        loader: async () => (await import("../commands/target")).target,
    }),
    init: buildCommand({
        docs: { brief: "Create the working copy with its frontmatter, and print its id and path" },
        parameters: { flags: { json: jsonFlag, base: baseFlag }, positional: refPositional },
        loader: async () => (await import("../commands/target")).init,
    }),
    path: buildCommand({
        docs: { brief: "Print the working copy path for a target" },
        parameters: { flags: { json: jsonFlag }, positional: refPositional },
        loader: async () => (await import("../commands/target")).path,
    }),
    hunks: buildCommand({
        docs: { brief: "Sort the changed files into classes and list the reviewable hunks" },
        parameters: { flags: { json: jsonFlag, base: baseFlag }, positional: refPositional },
        loader: async () => (await import("../commands/hunks")).hunks,
    }),
    lint: buildCommand({
        docs: { brief: "Check the digest against the format rules (exit 5 on an error)" },
        parameters: { flags: refFlags, positional: refPositional },
        loader: async () => (await import("../commands/lint")).lint,
    }),
    check: buildCommand({
        docs: { brief: "lint + anchor coverage (exit 5 on a lint error, 6 on a coverage gap)" },
        parameters: { flags: refFlags, positional: refPositional },
        loader: async () => (await import("../commands/lint")).check,
    }),
    fmt: buildCommand({
        docs: { brief: "Apply the safe fixes to the digest (--check: exit 5 if a fix is needed)" },
        parameters: {
            flags: {
                ...refFlags,
                check: { kind: "boolean", brief: "Change nothing; exit 5 if the file would change", default: false },
                questionsToNotes: {
                    kind: "boolean",
                    brief: "Move a Questions section into agent notes",
                    default: false,
                },
            },
            positional: refPositional,
        },
        loader: async () => (await import("../commands/fmt")).fmt,
    }),
};
