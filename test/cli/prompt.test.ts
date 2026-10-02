import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command, RouteMap } from "@stricli/core";
import { routes } from "../../src/cli/app";
import type { CliContext } from "../../src/cli/context";

const PROMPT = readFileSync(join(import.meta.dir, "../../prompts/review-agent.md"), "utf8");
/** The placeholders that the skill fills, with a sample value of the same shape. */
const PLACEHOLDERS: Readonly<Record<string, string>> = {
    WORKTREE: "/repo",
    BASE: "abc123",
    HEAD: "def456",
    DIGEST: "/home/store/repo/main.md",
    REF_ARGS: "main --base abc123",
    RANGE: "abc123",
};

function fill(text: string): string {
    return text.replaceAll(/\{\{(\w+)\}\}/gu, (_all, name: string) => {
        const value = PLACEHOLDERS[name];
        if (value === undefined) throw new Error(`The skill does not fill {{${name}}}.`);
        return value;
    });
}

/** The words of a shell command; a "quoted" string is one word. */
function words(text: string): string[] {
    return [...text.matchAll(/"[^"]*"|\S+/gu)].map(m => m[0]);
}

function command(names: readonly string[]): { command: Command<CliContext>; rest: number } {
    let target: Command<CliContext> | RouteMap<CliContext> = routes;
    let used = 0;
    while ("getRoutingTargetForInput" in target) {
        const name = names[used] ?? "";
        const next = target.getRoutingTargetForInput(name);
        if (next === undefined) throw new Error(`No command is named ${names.slice(0, used + 1).join(" ")}.`);
        target = next;
        used += 1;
    }
    return { command: target, rest: used };
}

/** The most positional arguments that a command takes. */
function maxPositionals(positional: Command<CliContext>["parameters"]["positional"]): number {
    if (positional === undefined) return 0;
    return positional.kind === "tuple" ? positional.parameters.length : Number.POSITIVE_INFINITY;
}

describe("the review-agent prompt", () => {
    test("each `diff-digest` command in it is a command, with its flags and the right number of arguments", () => {
        const calls = [...PROMPT.matchAll(/`diff-digest ([^`]+)`/gu)].map(m => words(fill(m[1] ?? "")));
        expect(calls.length).toBeGreaterThan(3);
        for (const call of calls) {
            const { command: c, rest } = command(call);
            const args = call.slice(rest);
            const positionals = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1]?.startsWith("--") ?? false));
            for (const flag of args.filter(a => a.startsWith("--")))
                expect({
                    call: call.join(" "),
                    flag,
                    known: c.usesFlag(flag.slice(2), "allow-kebab-for-camel"),
                }).toEqual({
                    call: call.join(" "),
                    flag,
                    known: true,
                });
            expect({
                call: call.join(" "),
                fits: positionals.length <= maxPositionals(c.parameters.positional),
            }).toEqual({
                call: call.join(" "),
                fits: true,
            });
        }
    });
});
