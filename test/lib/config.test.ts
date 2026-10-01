import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exactPattern, readConfigFile, resolveConfig, setGenerated } from "../../src/lib/config";
import { expectDigestError, tempDir } from "../helpers/repo";

let dir: string | undefined;
afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

function configFile(content: unknown): string {
    dir = tempDir("dd-config-");
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify(content));
    return path;
}

describe("config", () => {
    test("a missing file is an empty config with the github default", () => {
        dir = tempDir("dd-config-");
        const resolved = resolveConfig(readConfigFile(join(dir, "none.json")), ["repo"]);
        expect(resolved.publishTo).toEqual(["github"]);
        expect(Object.keys(resolved.backends)).toEqual(["github"]);
        expect(resolved.generated).toEqual([]);
    });

    test("an unknown key is BAD_CONFIG", () => {
        const path = configFile({ digestDir: "~/x" });
        expectDigestError(() => readConfigFile(path), "BAD_CONFIG");
    });

    test("a bad regex is BAD_CONFIG", () => {
        const path = configFile({ generated: ["("] });
        expectDigestError(() => readConfigFile(path), "BAD_CONFIG");
    });

    test("publishTo must name a backend", () => {
        expectDigestError(() => resolveConfig({ publishTo: ["notes"] }, ["repo"]), "BAD_CONFIG");
    });

    test("the repo entry is matched by name or host/owner/name and adds to the global list", () => {
        const resolved = resolveConfig(
            { generated: ["a"], repos: { "github.com/o/r": { generated: ["b"], publishTo: [] } } },
            ["r", "github.com/o/r"],
        );
        expect(resolved.key).toBe("github.com/o/r");
        expect(resolved.generated).toEqual(["a", "b"]);
        expect(resolved.repoGenerated).toEqual(["b"]);
        expect(resolved.publishTo).toEqual([]);
    });

    test("setGenerated adds and removes one exact pattern and keeps other keys", () => {
        const path = configFile({ generated: ["g"], repos: { r: { publishTo: ["github"] } } });
        setGenerated("src/a.b.ts", true, ["r"], path);
        expect(readConfigFile(path).repos?.["r"]).toEqual({
            publishTo: ["github"],
            generated: [String.raw`^src/a\.b\.ts$`],
        });
        setGenerated("src/a.b.ts", false, ["r"], path);
        expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
            generated: ["g"],
            repos: { r: { publishTo: ["github"], generated: [] } },
        });
    });

    test("exactPattern matches only the literal path", () => {
        const re = new RegExp(exactPattern("a+b/(c).ts"), "u");
        expect(re.test("a+b/(c).ts")).toBe(true);
        expect(re.test("aab/(c).ts")).toBe(false);
        expect(re.test("x/a+b/(c).ts")).toBe(false);
    });
});
