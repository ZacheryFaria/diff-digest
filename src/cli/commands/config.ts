// `config`: the settings for this repo.
import { existsSync } from "node:fs";
import { buildCommand } from "@stricli/core";
import { readConfigFile, resolveConfig } from "../../lib/config";
import { configPath } from "../../lib/paths";
import { findRepoRoot, repoKeys } from "../../lib/repo";
import { writeAtomic } from "../../lib/store";
import type { CliContext } from "../context";
import { emit } from "../output";
import { jsonFlag } from "./shared";
import { ConfigOutputSchema } from "../outputs";

export const configCommand = buildCommand({
    docs: { brief: "Show the settings for this repo" },
    parameters: {
        flags: {
            json: jsonFlag,
            init: { kind: "boolean", brief: "Write an empty config file if none exists", default: false },
        },
    },
    async func(this: CliContext, flags: { readonly json: boolean; readonly init: boolean }) {
        await emit(
            this.out,
            { json: flags.json, schema: ConfigOutputSchema, text: c => JSON.stringify(c, null, 2) },
            () => {
                const path = configPath(this.home);
                if (flags.init && !existsSync(path)) writeAtomic(path, "{}\n");
                const resolved = resolveConfig(readConfigFile(path), repoKeys(findRepoRoot(this.cwd)));
                return {
                    path,
                    exists: existsSync(path),
                    repoKeys: resolved.repoKeys,
                    key: resolved.key ?? null,
                    backends: resolved.backends,
                    publishTo: resolved.publishTo,
                    generated: resolved.generated,
                };
            },
        );
    },
});
