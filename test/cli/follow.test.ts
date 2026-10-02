import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FOLLOW_MS, followLog, readFrom } from "../../src/cli/follow";
import { tempDir } from "../helpers/repo";

let dir: string | undefined;
afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

function wait(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

describe("server logs -f", () => {
    test("readFrom reads only the new text, and starts again when the file is shorter", () => {
        dir = tempDir("dd-follow-");
        const log = join(dir, "server.log");
        writeFileSync(log, "one\n");
        const first = readFrom(log, 0);
        expect(first).toEqual({ text: "one\n", offset: 4 });
        appendFileSync(log, "two\n");
        expect(readFrom(log, first.offset).text).toBe("two\n");
        writeFileSync(log, "x\n");
        expect(readFrom(log, 8)).toEqual({ text: "x\n", offset: 2 });
        expect(readFrom(join(dir, "missing.log"), 3)).toEqual({ text: "", offset: 0 });
    });

    test("followLog prints each full line that is added, and keeps a part line until it ends", async () => {
        dir = tempDir("dd-follow-");
        const log = join(dir, "server.log");
        writeFileSync(log, "old\n");
        const lines: string[] = [];
        const done = followLog(
            log,
            4,
            line => {
                lines.push(line);
            },
            () => wait(FOLLOW_MS * 4),
        );
        appendFileSync(log, "new 1\nnew");
        await wait(FOLLOW_MS * 2);
        appendFileSync(log, " 2\n");
        await done;
        expect(lines).toEqual(["new 1", "new 2"]);
    });
});
