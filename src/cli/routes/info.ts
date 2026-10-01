// Commands that print documentation, settings, and schemas.
import { configCommand } from "../commands/config";
import { formatCommand, promptCommand } from "../commands/format";
import { schemaCommand } from "../commands/schema";

export const infoRoutes = {
    format: formatCommand,
    prompt: promptCommand,
    config: configCommand,
    schema: schemaCommand,
};
