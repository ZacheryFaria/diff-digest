import { join } from "node:path";
import { z } from "zod";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");

export interface CliResult {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

/** Runs `bun src/cli/index.ts …` in `cwd` with `DIFF_DIGEST_HOME=home`. */
export function runCli(args: readonly string[], cwd: string, home: string): CliResult {
    const result = Bun.spawnSync(["bun", CLI, ...args], {
        cwd,
        env: { ...process.env, DIFF_DIGEST_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
    });
    return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

const EnvelopeSchema = z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }).loose() }),
]);

/** The parsed `--json` envelope. */
export function envelope(result: CliResult): z.infer<typeof EnvelopeSchema> {
    return EnvelopeSchema.parse(JSON.parse(result.stdout));
}
