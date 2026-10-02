// Commands for the review: comments, the UI server, and waiting for clicks. Each loads its code when it runs.
import { buildCommand } from "@stricli/core";
import { MAX_WAIT_MS } from "../../lib/limits";
import { COMMENT_STATUSES, idFlag, jsonFlag, listFlag, parseSeconds, refFlag, refPositional } from "../commands/shared";
import { serverRoutes } from "./server";

const targetedFlags = { json: jsonFlag, id: idFlag, ref: refFlag } as const;

/** Two required string arguments: [brief, placeholder] each. */
function pair(first: readonly [string, string], second: readonly [string, string]) {
    return {
        kind: "tuple",
        parameters: [
            { brief: first[0], parse: String, placeholder: first[1] },
            { brief: second[0], parse: String, placeholder: second[1] },
        ],
    } as const;
}

export const reviewRoutes = {
    comments: buildCommand({
        docs: { brief: "Print the comments (default: open), or the open user comments as one Markdown comment" },
        parameters: {
            flags: {
                json: jsonFlag,
                id: idFlag,
                status: {
                    kind: "parsed",
                    parse: String,
                    brief: `A comma list of ${COMMENT_STATUSES.join(", ")}`,
                    default: "open",
                },
                markdown: {
                    kind: "boolean",
                    brief: "Print the open user comments as one Markdown comment",
                    default: false,
                },
                publish: {
                    kind: "boolean",
                    brief: "Post the open user comments as one review on the backends",
                    default: false,
                },
                to: listFlag("The backends for --publish (default: publishTo in the config)"),
            },
            positional: refPositional,
        },
        loader: async () => (await import("../commands/comments")).comments,
    }),
    resolve: buildCommand({
        docs: { brief: "Mark a comment resolved, with a one-line reply" },
        parameters: {
            flags: targetedFlags,
            positional: pair(["The comment id", "comment-id"], ["The reply", "reply"]),
        },
        loader: async () => (await import("../commands/comments")).resolve,
    }),
    note: buildCommand({
        docs: { brief: "Add an agent note to the digest block that contains the text" },
        parameters: { flags: targetedFlags, positional: pair(["Text from the block", "text"], ["The note", "body"]) },
        loader: async () => (await import("../commands/comments")).note,
    }),
    mark: buildCommand({
        docs: { brief: "List a file as generated in future digests for this repo (--off: review it again)" },
        parameters: {
            flags: { ...targetedFlags, off: { kind: "boolean", brief: "Unmark the file", default: false } },
            positional: {
                kind: "tuple",
                parameters: [{ brief: "The repo-relative path", parse: String, placeholder: "path" }],
            },
        },
        loader: async () => (await import("../commands/comments")).mark,
    }),
    publish: buildCommand({
        docs: { brief: "Post or update the digest on its backends (refuses lint errors unless --force)" },
        parameters: {
            flags: {
                json: jsonFlag,
                id: idFlag,
                to: listFlag("The backends (default: publishTo in the config)"),
                dryRun: { kind: "boolean", brief: "Print what would be posted, and post nothing", default: false },
                force: { kind: "boolean", brief: "Publish even with lint errors", default: false },
            },
            positional: refPositional,
        },
        loader: async () => (await import("../commands/publish")).publish,
    }),
    pull: buildCommand({
        docs: { brief: "Write the working copy from the first backend that has the digest for a target" },
        parameters: {
            flags: {
                json: jsonFlag,
                from: listFlag("The backends to try, in order (default: publishTo in the config)"),
                force: { kind: "boolean", brief: "Replace a working copy that exists", default: false },
            },
            positional: refPositional,
        },
        loader: async () => (await import("../commands/publish")).pull,
    }),
    export: buildCommand({
        docs: { brief: "Write one static HTML file of the digest; its anchors link to the repo web page" },
        parameters: {
            flags: {
                json: jsonFlag,
                id: idFlag,
                out: {
                    kind: "parsed",
                    parse: String,
                    brief: "The file (default: the working copy path with .html)",
                    optional: true,
                },
                open: { kind: "boolean", brief: "Open the file in the browser", default: false },
            },
            positional: refPositional,
        },
        loader: async () => (await import("../commands/export")).exportDigest,
    }),
    serve: buildCommand({
        docs: { brief: "Start the review server if it is not running, register the digest, and print its URL" },
        parameters: {
            flags: {
                json: jsonFlag,
                id: idFlag,
                open: { kind: "boolean", brief: "Open the URL in the browser", default: false },
            },
            positional: refPositional,
        },
        loader: async () => (await import("../commands/serve")).serve,
    }),
    wait: buildCommand({
        docs: { brief: "Wait until the user clicks a button in the UI, then print the action and its comments" },
        parameters: {
            flags: {
                json: jsonFlag,
                id: idFlag,
                timeout: {
                    kind: "parsed",
                    parse: parseSeconds,
                    brief: "The longest wait in seconds",
                    default: String(MAX_WAIT_MS / 1000),
                },
            },
            positional: refPositional,
        },
        loader: async () => (await import("../commands/wait")).wait,
    }),
    server: serverRoutes,
};
