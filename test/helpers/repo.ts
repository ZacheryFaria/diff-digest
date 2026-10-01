import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect } from "bun:test";
import { DigestError, type ErrorCode } from "../../src/lib/errors";
import { git, rev } from "../../src/lib/repo";
import type { Sha } from "../../src/lib/schemas";

export interface TestRepo {
    readonly root: string;
    readonly write: (path: string, content: string | readonly number[]) => void;
    readonly commit: (message: string) => Sha;
    readonly remove: () => void;
}

export function tempDir(prefix: string): string {
    // realpath: on macOS the temp folder is a symlink, and git prints the real path.
    return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A new git repo on branch `main`, with no commits. */
export function makeRepo(): TestRepo {
    const root = tempDir("dd-repo-");
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    return {
        root,
        write: (path, content) => {
            const full = join(root, path);
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, typeof content === "string" ? content : new Uint8Array(content));
        },
        commit: message => {
            git(root, ["add", "-A"]);
            git(root, ["commit", "-q", "-m", message]);
            return rev(root, "HEAD");
        },
        remove: () => {
            rmSync(root, { recursive: true, force: true });
        },
    };
}

export function expectDigestError(run: () => unknown, code: ErrorCode): DigestError {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(DigestError);
        if (error instanceof DigestError) {
            expect(error.code).toBe(code);
            return error;
        }
    }
    throw new Error(`Expected a DigestError with code ${code}, but nothing was thrown.`);
}
