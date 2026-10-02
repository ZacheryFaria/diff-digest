// `bun run build`: the one-file binary, with the UI, the docs, and the prompts inside.
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const BINARY = join(ROOT, "dist", "diff-digest");

/** The `bun build --compile` arguments. Without the define, the page gets development React. */
export function compileArgs(outfile: string): readonly string[] {
    return [
        "build",
        "--compile",
        "--minify",
        "--sourcemap",
        "--splitting",
        "--define",
        'process.env.NODE_ENV="production"',
        join(ROOT, "src", "cli", "index.ts"),
        "--outfile",
        outfile,
    ];
}

/** Builds the binary. Throws with bun's output when the build fails. */
export function buildBinary(outfile = BINARY): string {
    const result = Bun.spawnSync([process.execPath, ...compileArgs(outfile)], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(`The build failed:\n${result.stderr.toString()}`);
    return outfile;
}

if (import.meta.main) process.stdout.write(`${buildBinary(process.argv[2] ?? BINARY)}\n`);
