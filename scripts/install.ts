// `bun run setup [--uninstall] [--bin-dir <dir>] [--skills-dir <dir>] [--force]`: build the binary,
// then install it and the skill. It does not replace a file that it did not make, unless --force.
import {
    chmodSync,
    copyFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { BINARY, ROOT, buildBinary } from "./build";

export const MARKER = ".installed-by-diff-digest";

export interface InstallOptions {
    readonly home: string;
    readonly binDir: string;
    readonly skillsDir: string;
    readonly force: boolean;
    readonly binary: string;
    readonly skillSource: string;
}

export interface Installed {
    readonly command: string;
    readonly skill: string;
    readonly removedOldLib: boolean;
}

const InstallRecordSchema = z
    .object({
        paths: z.array(z.string()).readonly(),
        /** The sha256 of the copied binary, so a foreign file at the same path is not "ours". */
        binarySha256: z.string().optional(),
    })
    .readonly();
type InstallRecord = z.infer<typeof InstallRecordSchema>;

function sha256(path: string): string {
    return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
}

/** What the last install wrote, from `<home>/install.json`. */
function recorded(home: string): InstallRecord {
    try {
        const parsed: unknown = JSON.parse(readFileSync(join(home, "install.json"), "utf8"));
        return InstallRecordSchema.parse(parsed);
    } catch {
        return { paths: [] };
    }
}

/**
 * True when this installer made `path`: a folder with the marker, the recorded binary (same path and the
 * same sha256), or the old launcher script.
 */
function ours(path: string, home: string): boolean {
    if (existsSync(join(path, MARKER))) return true;
    const record = recorded(home);
    if (record.paths.includes(path) && statSync(path).isFile() && record.binarySha256 === sha256(path)) return true;
    try {
        return statSync(path).size < 4096 && readFileSync(path, "utf8").includes(MARKER);
    } catch {
        return false;
    }
}

function guard(path: string, options: InstallOptions): void {
    if (!existsSync(path) || options.force || ours(path, options.home)) return;
    throw new Error(`${path} exists and was not installed by diff-digest. Move it, or run again with --force.`);
}

function paths(options: InstallOptions): { readonly command: string; readonly skill: string; readonly lib: string } {
    return {
        command: join(options.binDir, "diff-digest"),
        skill: join(options.skillsDir, "diff-digest"),
        lib: join(options.home, "lib"),
    };
}

export function install(options: InstallOptions): Installed {
    const { command, skill, lib } = paths(options);
    guard(command, options);
    guard(skill, options);
    mkdirSync(options.binDir, { recursive: true });
    rmSync(command, { force: true });
    copyFileSync(options.binary, command);
    chmodSync(command, 0o755);
    rmSync(skill, { recursive: true, force: true });
    cpSync(options.skillSource, skill, { recursive: true });
    writeFileSync(join(skill, MARKER), "");
    // The old tool installed its source in ~/.diff-digest/lib.
    const removedOldLib = existsSync(join(lib, MARKER));
    if (removedOldLib) rmSync(lib, { recursive: true, force: true });
    mkdirSync(options.home, { recursive: true });
    const record: InstallRecord = { paths: [command, skill], binarySha256: sha256(command) };
    writeFileSync(join(options.home, "install.json"), `${JSON.stringify(record, null, 2)}\n`);
    return { command, skill, removedOldLib };
}

/** Removes the paths of the last install (also from another --bin-dir), the given paths, and the old lib/. */
export function uninstall(options: InstallOptions): readonly string[] {
    const { command, skill, lib } = paths(options);
    const named = [...recorded(options.home).paths, command, skill, ...(existsSync(join(lib, MARKER)) ? [lib] : [])];
    const targets = [...new Set(named)].filter(p => existsSync(p));
    for (const p of targets) guard(p, options);
    for (const p of [...targets, join(options.home, "install.json")]) rmSync(p, { recursive: true, force: true });
    return targets;
}

function optionsFromArgs(argv: readonly string[]): InstallOptions & { readonly uninstall: boolean } {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            "bin-dir": { type: "string" },
            "skills-dir": { type: "string" },
            force: { type: "boolean", default: false },
            uninstall: { type: "boolean", default: false },
        },
    });
    return {
        home: process.env["DIFF_DIGEST_HOME"] ?? join(homedir(), ".diff-digest"),
        binDir: resolve(values["bin-dir"] ?? join(homedir(), ".local", "bin")),
        skillsDir: resolve(values["skills-dir"] ?? join(homedir(), ".claude", "skills")),
        force: values.force,
        uninstall: values.uninstall,
        binary: BINARY,
        skillSource: join(ROOT, "skills", "diff-digest"),
    };
}

function main(argv: readonly string[]): void {
    const options = optionsFromArgs(argv);
    if (options.uninstall) {
        for (const p of uninstall(options)) process.stdout.write(`removed ${p}\n`);
        process.stdout.write(`Kept ${join(options.home, "config.json")} and ${join(options.home, "store")}.\n`);
        return;
    }
    buildBinary(options.binary);
    const done = install(options);
    process.stdout.write(`Installed diff-digest\n  command   ${done.command}\n  skill     ${done.skill}\n`);
    if (done.removedOldLib) process.stdout.write(`  removed   the old tool in ${join(options.home, "lib")}\n`);
    if (!(process.env["PATH"] ?? "").split(":").includes(options.binDir))
        process.stdout.write(`\nAdd ${options.binDir} to your PATH.\n`);
}

if (import.meta.main) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
