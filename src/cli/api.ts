// The contract procedures, called in-process (spec §7): the same handlers and validation as the server.
import { createRouterClient, type RouterClient } from "@orpc/server";
import { createServerContext } from "../server/context";
import { router } from "../server/router";

export function localApi(home: string): RouterClient<typeof router> {
    return createRouterClient(router, { context: createServerContext(home) });
}
