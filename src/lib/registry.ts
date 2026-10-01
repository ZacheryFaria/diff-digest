// Which repo root each working copy belongs to. `serve` writes it; the server reads it.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DigestError } from "./errors";
import { withLock } from "./lock";
import { homeDir } from "./paths";
import { RegistryFileSchema, type RegistryEntry, type RegistryFile } from "./schemas-api";
import { readJson, writeAtomic } from "./store";

export function registryPath(home: string = homeDir()): string {
    return join(home, "registry.json");
}

export function readRegistry(path: string = registryPath()): RegistryFile {
    if (!existsSync(path)) return { digests: {} };
    const result = RegistryFileSchema.safeParse(readJson(path));
    if (!result.success) throw new DigestError("BAD_INPUT", `${path} is not valid:\n${z.prettifyError(result.error)}`);
    return result.data;
}

/** Adds or updates one digest. */
export function registerDigest(
    entry: Omit<RegistryEntry, "updatedAt">,
    path: string = registryPath(),
    updatedAt: string = new Date().toISOString(),
): RegistryEntry {
    return withLock(path, () => {
        const current = readRegistry(path);
        const next: RegistryEntry = { ...entry, updatedAt };
        const file = RegistryFileSchema.parse({ digests: { ...current.digests, [entry.id]: next } });
        writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
        return next;
    });
}

export function findDigest(id: string, path: string = registryPath()): RegistryEntry {
    const entry = readRegistry(path).digests[id];
    if (entry === undefined)
        throw new DigestError("NOT_FOUND", `No digest has the id ${id}.`, { hint: "Run `diff-digest serve` for it." });
    return entry;
}

export function listDigests(path: string = registryPath()): readonly RegistryEntry[] {
    return Object.values(readRegistry(path).digests);
}
