import { rmSync, writeFileSync } from "node:fs";
import { createRouterClient, type RouterClient } from "@orpc/server";
import type { ExecResult } from "../../src/lib/backends/types";
import { registerDigest, registryPath } from "../../src/lib/registry";
import { git } from "../../src/lib/repo";
import { createServerContext } from "../../src/server/context";
import { router } from "../../src/server/router";
import { fakeDeps, type FakeCall } from "./backend";
import { makeDigest } from "./digest";
import { makeRepo, tempDir } from "./repo";

export interface PublishSetup {
    readonly root: string;
    readonly head: string;
    readonly mdPath: string;
    readonly client: RouterClient<typeof router>;
    readonly files: Map<string, string>;
    readonly calls: FakeCall[];
    /** The bodies that the fake gh posted or patched. */
    readonly posted: string[];
    readonly remove: () => void;
}

export interface PublishOptions {
    readonly config?: unknown;
    /** Answers a gh call before the default answers, or returns undefined. */
    readonly gh?: (call: FakeCall) => ExecResult | undefined;
    readonly frontmatter?: Parameters<typeof makeDigest>[3];
    readonly body?: string;
}

function ok(stdout: unknown): ExecResult {
    return { ok: true, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: "" };
}

/** The PR answer of the fake gh for PR `n`, with `head` as base and head. */
export function fakePull(n: number, head: string): unknown {
    return {
        html_url: `https://gh.dev/o/r/pull/${n}`,
        title: "T",
        state: "open",
        base: { ref: "main", sha: head },
        head: { ref: "main", sha: head },
    };
}

/**
 * A repo with an origin on gh.dev, a registered digest, and a server client with a fake gh.
 * By default gh has PR 7 for the branch, no comments, and posts comment 1.
 */
export function setupPublish(options: PublishOptions = {}): PublishSetup {
    const repo = makeRepo();
    const home = tempDir("dd-home-");
    repo.write("a.ts", "1\n");
    const head = repo.commit("init");
    git(repo.root, ["remote", "add", "origin", "git@gh.dev:o/r.git"]);
    repo.write("a.ts", "2\n");
    const body = options.body ?? "\n# Two\n\n## Changes\n\n- two: `a.ts:1`\n";
    const entry = makeDigest(repo, home, body, options.frontmatter);
    registerDigest(entry, registryPath(home));
    writeFileSync(`${home}/config.json`, JSON.stringify(options.config ?? {}));
    const posted: string[] = [];
    const { deps, files, calls } = fakeDeps(call => {
        const a = call.args;
        const custom = options.gh?.(call);
        if (custom !== undefined) return custom;
        if (a[0] === "pr") return ok([{ number: 7 }]);
        const pulls = /^repos\/o\/r\/pulls\/(\d+)$/u.exec(String(a[1]));
        if (pulls !== null) return ok(fakePull(Number(pulls[1]), head));
        if (a[1] === "--paginate") return ok("");
        posted.push(call.input ?? "");
        return ok({ id: 1, html_url: "https://gh.dev/o/r/pull/7#c1", body: "" });
    });
    const client = createRouterClient(router, { context: createServerContext(home, deps) });
    return {
        root: repo.root,
        head,
        mdPath: entry.mdPath,
        client,
        files,
        calls,
        posted,
        remove: () => {
            repo.remove();
            rmSync(home, { recursive: true, force: true });
        },
    };
}
