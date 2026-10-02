import { describe, expect, test } from "bun:test";
import { parsePrUrl } from "../../../src/lib/backends/pr";
import { checkNotAllFailed } from "../../../src/lib/publish/failures";

const FAILED = { backend: "github", code: "BACKEND_FAILED", message: "gh failed" } as const;
const BIG = { backend: "github", code: "BAD_INPUT", message: "too big" } as const;

describe("checkNotAllFailed", () => {
    test("a failure with nothing published throws, also when the other backends were skipped", () => {
        expect(() => {
            checkNotAllFailed([FAILED, { ...FAILED, backend: "notes" }], 0);
        }).toThrow(expect.objectContaining({ code: "BACKEND_FAILED" }));
        expect(() => {
            checkNotAllFailed([BIG], 0);
        }).toThrow(expect.objectContaining({ code: "BAD_INPUT" }));
    });

    test("one published backend is enough", () => {
        expect(() => {
            checkNotAllFailed([FAILED], 1);
        }).not.toThrow();
        expect(() => {
            checkNotAllFailed([], 0);
        }).not.toThrow();
    });
});

describe("parsePrUrl", () => {
    test("refuses . and .. as an owner or a repo", () => {
        expect(parsePrUrl("https://github.com/../r/pull/1")).toBeNull();
        expect(parsePrUrl("https://github.com/o/./pull/1")).toBeNull();
        expect(parsePrUrl("https://github.com/o.x/r..y/pull/1")).toMatchObject({ owner: "o.x", repo: "r..y" });
    });
});
