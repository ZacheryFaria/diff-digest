// Commands that make, check, and fix a digest.
import { fmtCommand } from "../commands/fmt";
import { hunksCommand } from "../commands/hunks";
import { checkCommand, lintCommand } from "../commands/lint";
import { initCommand, pathCommand, targetCommand } from "../commands/target";

export const digestRoutes = {
    target: targetCommand,
    init: initCommand,
    path: pathCommand,
    hunks: hunksCommand,
    lint: lintCommand,
    check: checkCommand,
    fmt: fmtCommand,
};
