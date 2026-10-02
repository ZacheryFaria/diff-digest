// The script and the styles of a static export. `export-assets.ts` runs this as a Bun macro. A macro
// cannot call `Bun.build`, so this runs `bun build` as a process into a temp folder.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ExportBundle {
    readonly js: string;
    readonly css: string;
}

const ENTRY = join(import.meta.dir, "..", "app", "export.html");

function readOne(dir: string, ext: string): string {
    const name = readdirSync(dir).find(f => f.endsWith(ext));
    if (name === undefined) throw new Error(`The export bundle has no ${ext} file.`);
    return readFileSync(join(dir, name), "utf8");
}

/** One script with no split chunks (mermaid inside), so the export is one file. */
export function buildExportBundle(): ExportBundle {
    const dir = mkdtempSync(join(tmpdir(), "dd-export-"));
    try {
        const args = ["build", ENTRY, "--outdir", dir, "--minify", "--define", 'process.env.NODE_ENV="production"'];
        const result = Bun.spawnSync([process.execPath, ...args], { stdout: "pipe", stderr: "pipe" });
        if (result.exitCode !== 0) throw new Error(`The export bundle did not build:\n${result.stderr.toString()}`);
        return { js: readOne(dir, ".js"), css: readOne(dir, ".css") };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
