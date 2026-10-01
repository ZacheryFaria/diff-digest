import { existsSync } from "node:fs";
import { z } from "zod";
import { DigestError } from "./errors";
import { configPath } from "./paths";
import { BackendConfigSchema, ConfigFileSchema, type BackendConfig, type ConfigFile, type RepoConfig } from "./schemas";
import { readJson, writeAtomic } from "./store";

export interface ResolvedConfig {
    /** The repo keys that were tried, then the key that matched (if any). */
    readonly repoKeys: readonly [string, ...string[]];
    readonly key: string | undefined;
    readonly backends: Readonly<Record<string, BackendConfig>>;
    readonly publishTo: readonly string[];
    /** Global and repo patterns together. */
    readonly generated: readonly string[];
    /** Only the patterns in this repo's entry. "Mark generated" writes here. */
    readonly repoGenerated: readonly string[];
}

const DEFAULT_BACKENDS: Readonly<Record<string, BackendConfig>> = {
    github: BackendConfigSchema.parse({ type: "github" }),
};

export function readConfigFile(path: string = configPath()): ConfigFile {
    if (!existsSync(path)) return {};
    const result = ConfigFileSchema.safeParse(readJson(path));
    if (!result.success) {
        throw new DigestError("BAD_CONFIG", `${path} is not valid:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
}

export function resolveConfig(file: Readonly<ConfigFile>, repoKeys: readonly [string, ...string[]]): ResolvedConfig {
    const key = repoKeys.find(k => file.repos?.[k] !== undefined);
    const repo: RepoConfig = key === undefined ? {} : (file.repos?.[key] ?? {});
    const backends = file.backends ?? DEFAULT_BACKENDS;
    const publishTo = repo.publishTo ?? file.publishTo ?? ["github"];
    for (const name of publishTo) {
        if (backends[name] === undefined) {
            throw new DigestError("BAD_CONFIG", `publishTo names "${name}", but no backend has that name.`);
        }
    }
    return {
        repoKeys,
        key,
        backends,
        publishTo,
        generated: [...(file.generated ?? []), ...(repo.generated ?? [])],
        repoGenerated: repo.generated ?? [],
    };
}

/** A test for the config's generated patterns. The patterns are compiled once. */
export function generatedMatcher(config: ResolvedConfig): (path: string) => boolean {
    const patterns = config.generated.map(r => new RegExp(r, "u"));
    return path => {
        for (const pattern of patterns) if (pattern.test(path)) return true;
        return false;
    };
}

/** The pattern that "Mark generated" writes for one file. */
export function exactPattern(path: string): string {
    return `^${path.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}$`;
}

/** Adds or removes one file's exact pattern in this repo's entry. Keeps every other key as it was. */
export function setGenerated(
    path: string,
    on: boolean,
    repoKeys: readonly [string, ...string[]],
    file: string = configPath(),
): void {
    const current = readConfigFile(file);
    const key = repoKeys.find(k => current.repos?.[k] !== undefined) ?? repoKeys[0];
    const repo = current.repos?.[key] ?? {};
    const pattern = exactPattern(path);
    const rest = (repo.generated ?? []).filter(r => r !== pattern);
    const next = ConfigFileSchema.parse({
        ...current,
        repos: { ...current.repos, [key]: { ...repo, generated: on ? [...rest, pattern] : rest } },
    });
    writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
}
