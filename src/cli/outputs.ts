// Every command's output schema, by command name. `diff-digest schema <name>` prints one as JSON Schema.
import { z } from "zod";
import { BackendConfigSchema } from "../lib/schemas";

export const TextOutputSchema = z.string();

export const ConfigOutputSchema = z
    .strictObject({
        path: z.string(),
        exists: z.boolean(),
        repoKeys: z.array(z.string()).readonly(),
        key: z.string().nullable(),
        backends: z.record(z.string(), BackendConfigSchema).readonly(),
        publishTo: z.array(z.string()).readonly(),
        generated: z.array(z.string()).readonly(),
    })
    .readonly();
export type ConfigOutput = z.infer<typeof ConfigOutputSchema>;

export const SchemaOutputSchema = z.unknown();

export const OUTPUTS = {
    format: TextOutputSchema,
    prompt: TextOutputSchema,
    config: ConfigOutputSchema,
    schema: SchemaOutputSchema,
} as const;

export type CommandName = keyof typeof OUTPUTS;

export function isCommandName(name: string): name is CommandName {
    return Object.hasOwn(OUTPUTS, name);
}
