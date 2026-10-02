import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { install, MARKER, uninstall, type InstallOptions } from "../../scripts/install";
import { tempDir } from "../helpers/repo";

let root: string | undefined;
afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

function setup(): InstallOptions {
    root = tempDir("dd-install-");
    const binary = join(root, "built");
    writeFileSync(binary, "binary");
    const skillSource = join(root, "skill-src");
    mkdirSync(skillSource);
    writeFileSync(join(skillSource, "SKILL.md"), "# skill\n");
    return {
        home: join(root, "home"),
        binDir: join(root, "bin"),
        skillsDir: join(root, "skills"),
        force: false,
        binary,
        skillSource,
    };
}

describe("setup", () => {
    test("installs the binary and the skill, and installs again over its own files", () => {
        const o = setup();
        const done = install(o);
        expect(readFileSync(done.command, "utf8")).toBe("binary");
        expect(readFileSync(join(done.skill, "SKILL.md"), "utf8")).toBe("# skill\n");
        expect(() => install(o)).not.toThrow();
    });

    test("does not replace a file that it did not make, unless --force", () => {
        const o = setup();
        mkdirSync(o.binDir);
        writeFileSync(join(o.binDir, "diff-digest"), "someone else's");
        expect(() => install(o)).toThrow(/was not installed by diff-digest/u);
        expect(install({ ...o, force: true }).command).toBe(join(o.binDir, "diff-digest"));
    });

    test("replaces the old launcher and removes the old tool in lib/", () => {
        const o = setup();
        mkdirSync(o.binDir);
        writeFileSync(join(o.binDir, "diff-digest"), `#!/bin/sh\n# ${MARKER}\nexec bun x\n`);
        mkdirSync(join(o.home, "lib"), { recursive: true });
        writeFileSync(join(o.home, "lib", MARKER), "");
        expect(install(o).removedOldLib).toBe(true);
        expect(existsSync(join(o.home, "lib"))).toBe(false);
    });

    test("uninstall removes what it installed and keeps the config and the store", () => {
        const o = setup();
        mkdirSync(join(o.home, "store"), { recursive: true });
        writeFileSync(join(o.home, "config.json"), "{}");
        const done = install(o);
        expect(uninstall(o)).toEqual([done.command, done.skill]);
        expect(existsSync(done.command) || existsSync(done.skill)).toBe(false);
        expect(existsSync(join(o.home, "config.json")) && existsSync(join(o.home, "store"))).toBe(true);
    });
});
