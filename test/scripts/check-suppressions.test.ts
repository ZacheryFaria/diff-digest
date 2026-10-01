import { describe, expect, test } from "bun:test";
import { findSuppressions, type Suppression } from "../../scripts/check-suppressions";

const IGNORE = ["// @ts", "-ignore"].join("");
const DISABLE = ["// oxlint", "-disable-next-line no-console"].join("");

describe("findSuppressions", () => {
    test("reports each banned comment with its line", () => {
        const files = [{ path: "src/a.ts", text: `const a = 1;\n${IGNORE}\nconst b = 2;\n${DISABLE}\n` }];
        expect(findSuppressions(files, [])).toEqual([
            { path: "src/a.ts", line: 2, match: ["@ts", "-ignore"].join("") },
            { path: "src/a.ts", line: 4, match: ["oxlint", "-disable"].join("") },
        ]);
    });

    test("an approved entry for the same file, text, and rule is allowed", () => {
        const allowed: Suppression[] = [
            { file: "src/a.ts", text: "oxlint", rule: "no-console", reason: "CLI output", approvedBy: "zfaria" },
        ];
        const files = [
            { path: "src/a.ts", text: DISABLE },
            { path: "src/b.ts", text: DISABLE },
        ];
        expect(findSuppressions(files, allowed)).toEqual([
            { path: "src/b.ts", line: 1, match: ["oxlint", "-disable"].join("") },
        ]);
    });
});
