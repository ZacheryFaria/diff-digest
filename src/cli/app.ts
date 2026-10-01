// The command tree.
import { buildApplication, buildRouteMap, help, version } from "@stricli/core";
import { VERSION } from "../lib/version";
import { digestRoutes } from "./routes/digest";
import { infoRoutes } from "./routes/info";
import { reviewRoutes } from "./routes/review";

export const routes = buildRouteMap({
    docs: { brief: "Make a git diff into a short, reviewable change spec, and review it in a local UI" },
    routes: { ...digestRoutes, ...reviewRoutes, ...infoRoutes },
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
