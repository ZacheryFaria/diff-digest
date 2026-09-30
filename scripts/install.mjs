#!/usr/bin/env bun
// Usage: bun run setup [--uninstall] [--bin-dir <dir>] [--skills-dir <dir>] [--force]
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL_FILES = ["bin", "ui", "docs", "prompts", "package.json"];
const MARKER = ".installed-by-diff-digest";

const args = parseArgs(process.argv.slice(2));
const home = process.env.DIFF_DIGEST_HOME ?? join(homedir(), ".diff-digest");
const lib = join(home, "lib");
const binDir = resolve(args["bin-dir"] ?? join(homedir(), ".local", "bin"));
const launcher = join(binDir, "diff-digest");
const skill = join(resolve(args["skills-dir"] ?? join(homedir(), ".claude", "skills")), "diff-digest");

if (args.uninstall) uninstall();
else install();

function install() {
    guard(skill);
    guard(launcher);

    rmSync(lib, { recursive: true, force: true });
    mkdirSync(lib, { recursive: true });
    for (const f of TOOL_FILES) cpSync(join(SOURCE, f), join(lib, f), { recursive: true });
    writeFileSync(join(lib, MARKER), "");

    mkdirSync(binDir, { recursive: true });
    writeFileSync(launcher, `#!/bin/sh\n# ${MARKER}\nexec bun "${join(lib, "bin", "diff-digest.mjs")}" "$@"\n`);
    chmodSync(launcher, 0o755);

    rmSync(skill, { recursive: true, force: true });
    cpSync(join(SOURCE, "skills", "diff-digest"), skill, { recursive: true });
    writeFileSync(join(skill, MARKER), "");

    const config = join(home, "config.json");
    if (!existsSync(config)) writeFileSync(config, `${JSON.stringify({ generated: [], repos: {} }, null, 2)}\n`);

    console.log(`Installed diff-digest ${version()}
  tool      ${lib}
  command   ${launcher}
  skill     ${skill}
  config    ${config}`);
    if (!process.env.PATH.split(delimiter).includes(binDir)) console.log(`\nAdd ${binDir} to your PATH.`);
    if (!Bun.which("bun")) console.log("\nThe command needs `bun` on your PATH.");
}

function uninstall() {
    for (const p of [lib, skill, launcher]) {
        if (!existsSync(p)) continue;
        guard(p);
        rmSync(p, { recursive: true, force: true });
        console.log(`removed ${p}`);
    }
    console.log(`Kept ${join(home, "config.json")} and ${join(home, "digests")}.`);
}

// Refuses to replace a file or folder that this installer did not make, unless --force.
function guard(p) {
    if (!existsSync(p) || args.force) return;
    const ours = existsSync(join(p, MARKER)) || (p === launcher && readFileSync(p, "utf8").includes(MARKER));
    if (!ours) {
        console.error(`${p} exists and was not installed by diff-digest. Move it, or run again with --force.`);
        process.exit(1);
    }
}

function version() {
    return JSON.parse(readFileSync(join(SOURCE, "package.json"), "utf8")).version;
}

function parseArgs(list) {
    const out = {};
    for (let i = 0; i < list.length; i++) {
        const key = list[i].replace(/^--/, "");
        out[key] = key.endsWith("-dir") ? list[++i] : true;
    }
    return out;
}
