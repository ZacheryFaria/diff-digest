// The oRPC implementer for the contract, with the server context and the error middleware.
import { implement, ORPCError } from "@orpc/server";
import { contract } from "../lib/contract";
import { DigestError } from "../lib/errors";
import { openDigest, type OpenDigest } from "../lib/payload";
import { findDigest, registryPath } from "../lib/registry";
import type { BackendDeps } from "../lib/backends/types";
import type { Action, ActionStatus, RegistryEntry, ServerEvent, WaitResult } from "../lib/schemas-api";

/** What procedures use from the event bus (`EventBus` implements it). */
export interface Bus {
    readonly publish: (id: string, event: ServerEvent) => void;
    readonly subscribe: (id: string, listener: (event: ServerEvent) => void) => () => void;
    readonly watchedSince: (id: string) => number | null;
}

/** What procedures use from the action hub (`ActionHub` implements it). */
export interface Actions {
    readonly send: (action: Action) => ActionStatus;
    readonly wait: (id: string, timeoutMs: number, onCancel: (cancel: () => void) => void) => Promise<WaitResult>;
    readonly status: (id: string) => ActionStatus;
}

export interface ServerContext {
    readonly home: string;
    /** Processes and files for the backends (tests give a fake). */
    readonly deps: BackendDeps;
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

/** The registry entry only. Comments and actions use it: they need the digest file, not the repo. */
export function entryById(context: ServerContext, id: string): RegistryEntry {
    return findDigest(id, registryPath(context.home));
}

/** The digest with its repo context and changed files, for the digest and file views. */
export function openById(context: ServerContext, id: string): OpenDigest {
    return openDigest(entryById(context, id), context.home);
}
