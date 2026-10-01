// The oRPC implementer for the contract, with the server context and the error middleware.
import { implement, ORPCError } from "@orpc/server";
import { contract } from "../lib/contract";
import { DigestError } from "../lib/errors";
import { openDigest, type OpenDigest } from "../lib/payload";
import { findDigest, registryPath } from "../lib/registry";
import type { Action, ActionStatus, ServerEvent, WaitResult } from "../lib/schemas-api";

/** What procedures use from the event bus (`EventBus` implements it). */
export interface Bus {
    readonly publish: (id: string, event: ServerEvent) => void;
    readonly subscribe: (id: string, listener: (event: ServerEvent) => void) => () => void;
}

/** What procedures use from the action hub (`ActionHub` implements it). */
export interface Actions {
    readonly send: (action: Action) => ActionStatus;
    readonly wait: (id: string, timeoutMs: number, onCancel: (cancel: () => void) => void) => Promise<WaitResult>;
    readonly status: (id: string) => ActionStatus;
}

export interface ServerContext {
    readonly home: string;
    readonly bus: Bus;
    readonly actions: Actions;
    /** The current time as an ISO string (a function, so tests can fix it). */
    readonly now: () => string;
    /** A new comment id. */
    readonly newId: () => string;
}

/** A DigestError becomes an ORPCError with the same code, so every client gets the code and the hint. */
export const os = implement(contract)
    .$context<ServerContext>()
    .use(async ({ next }) => {
        try {
            return await next();
        } catch (error) {
            if (error instanceof DigestError)
                throw new ORPCError(error.code, { message: error.message, data: error.toJSON() });
            throw error;
        }
    });

export function openById(context: ServerContext, id: string): OpenDigest {
    return openDigest(findDigest(id, registryPath(context.home)), context.home);
}
