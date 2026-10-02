// Commands that print documentation, settings, and schemas. `format`, `prompt`, and `config` load at
// start (they are small); `schema` loads its code when it runs.
import { buildCommand } from "@stricli/core";
import { configCommand } from "../commands/config";
import { formatCommand, promptCommand } from "../commands/format";
import { jsonFlag } from "../commands/shared";

export const infoRoutes = {
    format: formatCommand,
    prompt: promptCommand,
    config: configCommand,
    schema: buildCommand({
        docs: { brief: "Print the JSON Schema of a command's output, or the OpenAPI spec of the HTTP contract" },
        parameters: {
            flags: {
                json: jsonFlag,
                openapi: { kind: "boolean", brief: "Print the OpenAPI spec of the HTTP contract", default: false },
            },
            positional: {
                kind: "tuple",
                parameters: [{ brief: "A command name", parse: String, placeholder: "name", optional: true }],
            },
        },
        loader: async () => (await import("../commands/schema")).schema,
    }),
};
