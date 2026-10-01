// Fails when a file in src/, scripts/, or test/ has a lint, type, or format suppression
// that suppressions.json does not list. Only the user adds entries to suppressions.json.
import { readFileSync } from "node:fs";
import { z } from "zod";

// Built from parts, so this file does not match itself.
const BANNED: readonly string[] = (
    [
        ["@ts", "-ignore"],
        ["@ts", "-expect-error"],
        ["@ts", "-nocheck"],
        ["oxlint", "-disable"],
        ["eslint", "-disable"],
        ["prettier", "-ignore"],
    ] as const
).map(parts => parts.join(""));

export const SuppressionSchema = z.strictObject({
    file: z.string().min(1),
    /** Text that the suppressed line must contain. */
    text: z.string().min(1),
    rule: z.string().min(1),
    reason: z.string().min(1),
    approvedBy: z.string().min(1),
});
export type Suppression = z.infer<typeof SuppressionSchema>;

export interface SourceFile {
    readonly path: string;
    readonly text: string;
}

export interface Violation {
    readonly path: string;
    readonly line: number;
    readonly match: string;
}

export function findSuppressions(files: readonly SourceFile[], allowed: readonly Suppression[]): Violation[] {
    const violations: Violation[] = [];
    for (const file of files) {
        for (const [i, line] of file.text.split("\n").entries()) {
            const match = BANNED.find(b => line.includes(b));
            if (match === undefined) continue;
            const ok = allowed.some(a => a.file === file.path && line.includes(a.text) && line.includes(a.rule));
            if (!ok) violations.push({ path: file.path, line: i + 1, match });
        }
    }
    return violations;
}

function main(): void {
    const allowed = z.array(SuppressionSchema).parse(JSON.parse(readFileSync("suppressions.json", "utf8")));
    const files: SourceFile[] = [];
    for (const path of new Bun.Glob("{src,scripts,test}/**/*.{ts,tsx,js,mjs,css,html}").scanSync(".")) {
        files.push({ path, text: readFileSync(path, "utf8") });
    }
    const violations = findSuppressions(files, allowed);
    for (const v of violations) {
        console.error(
            `${v.path}:${v.line}: "${v.match}" is not allowed. Ask the user, then add it to suppressions.json.`,
        );
    }
    if (violations.length > 0) process.exit(1);
}

if (import.meta.main) main();
