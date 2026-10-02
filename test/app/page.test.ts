import { describe, expect, test } from "bun:test";
import { codeFromHash, digestIdFromPath, liveFromSearch } from "../../src/app/api";
import { isEmptyReport, reportSummary } from "../../src/app/publish-report";
import { errorText } from "../../src/app/state/attempt";
import type { PublishReport } from "../../src/lib/publish/schemas";

const EMPTY: PublishReport = { results: [], previews: [], skipped: [], errors: [] };

describe("digestIdFromPath", () => {
    test("reads the id of /d/<id>/ only", () => {
        expect(digestIdFromPath("/d/ab12cd34/")).toBe("ab12cd34");
        expect(digestIdFromPath("/d/ab12cd34")).toBe("ab12cd34");
        expect(digestIdFromPath("/d/AB12CD34/")).toBeNull();
        expect(digestIdFromPath("/d/ab12cd34/x")).toBeNull();
        expect(digestIdFromPath("/")).toBeNull();
    });
});

describe("codeFromHash", () => {
    test("reads a path, a line, and a range, in the Diff view", () => {
        expect(codeFromHash("#code=src/a.ts")).toEqual({ path: "src/a.ts", rev: "diff" });
        expect(codeFromHash("#code=src/a.ts:10")).toEqual({ path: "src/a.ts", rev: "diff", start: 10, end: 10 });
        expect(codeFromHash("#code=src/a.ts:10-20")).toEqual({ path: "src/a.ts", rev: "diff", start: 10, end: 20 });
        expect(codeFromHash("#code=src/my%20file.ts:3")).toEqual({
            path: "src/my file.ts",
            rev: "diff",
            start: 3,
            end: 3,
        });
    });

    test("gives null for no link, an empty path, or bad escapes", () => {
        expect(codeFromHash("")).toBeNull();
        expect(codeFromHash("#other")).toBeNull();
        expect(codeFromHash("#code=")).toBeNull();
        expect(codeFromHash("#code=%E0%A4%A")).toBeNull();
    });
});

describe("liveFromSearch", () => {
    test("is off only with live=0", () => {
        expect(liveFromSearch("")).toBe(true);
        expect(liveFromSearch("?live=1")).toBe(true);
        expect(liveFromSearch("?live=0")).toBe(false);
        expect(liveFromSearch("?x=1&live=0")).toBe(false);
    });
});

describe("reportSummary", () => {
    test("names each posted, updated, skipped, and failed backend", () => {
        const report: PublishReport = {
            results: [
                { backend: "gh", ref: "https://x", updated: false, warnings: [] },
                { backend: "local", ref: "/tmp/a.md", updated: true, warnings: [] },
            ],
            previews: [],
            skipped: ["other"],
            errors: [{ backend: "bad", code: "BACKEND_FAILED", message: "no token" }],
        };
        expect(reportSummary(report)).toBe("posted gh; updated local; skipped other; bad failed: no token");
        expect(isEmptyReport(report)).toBe(false);
    });

    test("tells the user to choose a backend when the report is empty", () => {
        expect(isEmptyReport(EMPTY)).toBe(true);
        expect(reportSummary(EMPTY)).toBe("No backend. Choose one, or set publishTo in the config.");
    });
});

describe("errorText", () => {
    test("adds the error's hint to its message", () => {
        expect(errorText(new Error("Refused"))).toBe("Refused");
        expect(errorText(Object.assign(new Error("Lint failed"), { data: { hint: "Use --force." } }))).toBe(
            "Lint failed Use --force.",
        );
        expect(errorText("plain")).toBe("plain");
    });
});
