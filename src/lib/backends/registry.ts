// Builds the configured backends. A new backend is one new file and one line here.
import { readConfigFile, resolveConfig, type ResolvedConfig } from "../config";
import { DigestError } from "../errors";
import { configPath } from "../paths";
import { repoKeys } from "../repo";
import { createGithubBackend } from "./github";
import { createLocalBackend } from "./local";
import type { Backend, BackendDeps } from "./types";

export function createBackend(name: string, config: ResolvedConfig, deps: BackendDeps): Backend {
    const backend = config.backends[name];
    if (backend === undefined)
        throw new DigestError("NO_BACKEND", `No backend is named ${name}.`, {
            hint: `Configured: ${Object.keys(config.backends).join(", ")}.`,
        });
    return backend.type === "github" ? createGithubBackend(name, deps) : createLocalBackend(name, backend, deps);
}

/** The backends for `--to` / `--from` names, or the config's `publishTo` when none are given. */
export function chooseBackends(names: readonly string[], config: ResolvedConfig, deps: BackendDeps): Backend[] {
    const chosen = names.length > 0 ? names : config.publishTo;
    if (chosen.length === 0)
        throw new DigestError("NO_BACKEND", "No backend is chosen.", {
            hint: "Give --to, or set publishTo in the config.",
        });
    return chosen.map(n => createBackend(n, config, deps));
}

/** The backends for a repo, from the config file in `home`. */
export function backendsFor(
    root: string,
    names: readonly string[],
    home: string | undefined,
    deps: BackendDeps,
): Backend[] {
    return chooseBackends(names, resolveConfig(readConfigFile(configPath(home)), repoKeys(root)), deps);
}
