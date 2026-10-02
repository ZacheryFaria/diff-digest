// The read-only client for a static export: the reads come from the payload in the page, and each write
// throws READ_ONLY. The UI hides the write controls, so a write here is a bug.
import { implement, ORPCError, createRouterClient } from "@orpc/server";
import type { ApiClient } from "../lib/client";
import { contract } from "../lib/contract";
import { StaticPayloadSchema, type StaticPayload } from "../lib/schemas-api";

export type { StaticPayload } from "../lib/schemas-api";

/** The payload from the page's JSON script, or null when it is missing or does not match. */
export function readPayload(json: string): StaticPayload | null {
    try {
        return StaticPayloadSchema.safeParse(JSON.parse(json)).data ?? null;
    } catch {
        return null;
    }
}

function readOnly(): never {
    throw new ORPCError("READ_ONLY", { message: "This is a static export. It cannot change anything." });
}

export function staticApi(payload: StaticPayload): ApiClient {
    const os = implement(contract);
    const idle = { listening: 0, queued: 0 } as const;
    const router = os.router({
        digest: {
            get: os.digest.get.handler(() => payload.digest),
            lint: os.digest.lint.handler(() => []),
            check: os.digest.check.handler(() => ({ issues: [], gaps: [] })),
        },
        files: {
            diff: os.files.diff.handler(readOnly),
            read: os.files.read.handler(readOnly),
            setGenerated: os.files.setGenerated.handler(readOnly),
        },
        comments: {
            list: os.comments.list.handler(() => payload.comments),
            add: os.comments.add.handler(readOnly),
            remove: os.comments.remove.handler(readOnly),
            resolve: os.comments.resolve.handler(readOnly),
            note: os.comments.note.handler(readOnly),
            markShared: os.comments.markShared.handler(readOnly),
        },
        actions: {
            send: os.actions.send.handler(readOnly),
            wait: os.actions.wait.handler(readOnly),
            status: os.actions.status.handler(() => idle),
        },
        // An event stream that sends nothing and ends only when the page closes it.
        events: os.events.handler(async function* ({ signal }) {
            await new Promise<void>(resolve => {
                signal?.addEventListener("abort", () => {
                    resolve();
                });
            });
            yield* [];
        }),
        publish: {
            digest: os.publish.digest.handler(readOnly),
            review: os.publish.review.handler(readOnly),
            backends: os.publish.backends.handler(() => []),
        },
    });
    return createRouterClient(router);
}
