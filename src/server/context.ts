import { randomUUID } from "node:crypto";
import { realDeps } from "../lib/backends/deps";
import type { BackendDeps } from "../lib/backends/types";
import { homeDir } from "../lib/paths";
import { ActionHub } from "./actions";
import { EventBus } from "./bus";
import type { ServerContext } from "./os";

/** A context with a new event bus and action hub. The CLI uses one in-process; the server keeps one. */
export function createServerContext(
    home: string = homeDir(),
    deps: BackendDeps = realDeps,
): ServerContext & { readonly bus: EventBus; readonly actions: ActionHub } {
    const bus = new EventBus();
    const actions = new ActionHub((id, status) => {
        bus.publish(id, { type: "status", status });
    });
    return { home, deps, bus, actions, now: () => new Date().toISOString(), newId: () => randomUUID().slice(0, 8) };
}
