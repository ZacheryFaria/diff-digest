// The command tree.
import { buildApplication, buildRouteMap, help, version } from "@stricli/core";
import { VERSION } from "../lib/version";
import { configCommand } from "./commands/config";
import { fmtCommand } from "./commands/fmt";
import { checkCommand, lintCommand } from "./commands/lint";
import { formatCommand, promptCommand } from "./commands/format";
import { schemaCommand } from "./commands/schema";
import { hunksCommand } from "./commands/hunks";
import { initCommand, pathCommand, targetCommand } from "./commands/target";

export const routes = buildRouteMap({
    docs: { brief: "Make a git diff into a short, reviewable change spec, and review it in a local UI" },
    routes: {
        target: targetCommand,
        init: initCommand,
        path: pathCommand,
        hunks: hunksCommand,
        lint: lintCommand,
        check: checkCommand,
        fmt: fmtCommand,
        format: formatCommand,
        prompt: promptCommand,
        config: configCommand,
        schema: schemaCommand,
    },
});

export const app = buildApplication(
    routes,
    { name: "diff-digest", scanner: { caseStyle: "allow-kebab-for-camel" } },
    {
        help: help({
            alias: "h",
            brief: "Print help and exit",
            formatting: {
                useAliasInUsageLine: false,
                onlyRequiredInUsageLine: false,
                caseStyle: "convert-camel-to-kebab",
            },
        }),
        version: version({ info: { currentVersion: VERSION }, alias: "v", brief: "Print the version and exit" }),
    },
);
