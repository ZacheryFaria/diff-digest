// `format` and `prompt`: documentation for agents. The text is inside the binary.
import { buildCommand } from "@stricli/core";
import formatDoc from "../../../docs/format.md" with { type: "text" };
import reviewAgent from "../prompts/review-agent.md" with { type: "text" };
import { DigestError } from "../../lib/errors";
import { formatRulesMarkdown } from "../../lib/lint";
import type { CliContext } from "../context";
import { emit } from "../output";
import { jsonFlag } from "./shared";
import { TextOutputSchema } from "../outputs";

const PROMPTS: Readonly<Record<string, string>> = { "review-agent": reviewAgent };

export const formatCommand = buildCommand({
    docs: { brief: "Print the digest format and the lint rules" },
    parameters: { flags: { json: jsonFlag } },
    async func(this: CliContext, flags: { readonly json: boolean }) {
        await emit(
            this.out,
            { json: flags.json, schema: TextOutputSchema, text: t => t },
            () => `${formatDoc.trimEnd()}\n\n${formatRulesMarkdown()}`,
        );
    },
});

export const promptCommand = buildCommand({
    docs: { brief: "Print a prompt for an agent" },
    parameters: {
        flags: { json: jsonFlag },
        positional: {
            kind: "tuple",
            parameters: [
                { brief: `The prompt name (${Object.keys(PROMPTS).join(", ")})`, parse: String, placeholder: "name" },
            ],
        },
    },
    async func(this: CliContext, flags: { readonly json: boolean }, name: string) {
        await emit(this.out, { json: flags.json, schema: TextOutputSchema, text: t => t }, () => {
            const prompt = PROMPTS[name];
            if (prompt === undefined)
                throw new DigestError("NOT_FOUND", `No prompt is named ${name}.`, {
                    hint: `Use one of: ${Object.keys(PROMPTS).join(", ")}.`,
                });
            return prompt;
        });
    },
});
