// `schema`: the JSON Schema of each command's output, and the OpenAPI spec of the HTTP contract.
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { z } from "zod";
import { contract } from "../../lib/contract";
import { DigestError } from "../../lib/errors";
import { VERSION } from "../../lib/version";
import type { CliContext } from "../context";
import { emit } from "../output";
import { isCommandName, OUTPUTS, SchemaOutputSchema } from "../outputs";

export async function schema(
    this: CliContext,
    flags: { readonly json: boolean; readonly openapi: boolean },
    name?: string,
): Promise<void> {
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
}
