// `schema`: the JSON Schema of each command's output, and the OpenAPI spec of the HTTP contract.
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { buildCommand } from "@stricli/core";
import { z } from "zod";
import { contract } from "../../lib/contract";
import { DigestError } from "../../lib/errors";
import { VERSION } from "../../lib/version";
import type { CliContext } from "../context";
import { emit, jsonFlag } from "../output";
import { isCommandName, OUTPUTS, SchemaOutputSchema } from "../outputs";

export const schemaCommand = buildCommand({
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
    async func(this: CliContext, flags: { readonly json: boolean; readonly openapi: boolean }, name?: string) {
        await emit(
            this.out,
            {
                json: flags.json,
                schema: SchemaOutputSchema,
                // The list of names prints one name per line.
                text: s => (Array.isArray(s) ? s.join("\n") : JSON.stringify(s, null, 2)),
            },
            () => {
                if (flags.openapi) {
                    const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] });
                    return generator.generate(contract, { info: { title: "diff-digest", version: VERSION } });
                }
                if (name === undefined) return Object.keys(OUTPUTS);
                // `server-status` is the same as `server status`.
                const command = isCommandName(name) ? name : name.replaceAll("-", " ");
                if (!isCommandName(command))
                    throw new DigestError("NOT_FOUND", `No command is named ${name}.`, {
                        hint: "Run `diff-digest schema` for the names.",
                    });
                return z.toJSONSchema(OUTPUTS[command], { io: "output", unrepresentable: "any" });
            },
        );
    },
});
