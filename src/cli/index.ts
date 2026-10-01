#!/usr/bin/env bun
// The diff-digest command.
import { ExitCode, run } from "@stricli/core";
import { app } from "./app";
import { buildContext } from "./context";

await run(app, process.argv.slice(2), buildContext());
// Usage errors exit with 2 (spec §6). Stricli's codes are negative; the process keeps the low 8 bits.
const usage = new Set([ExitCode.UnknownCommand & 0xff, ExitCode.InvalidArgument & 0xff]);
if (usage.has(Number(process.exitCode ?? 0) & 0xff)) process.exitCode = 2;
