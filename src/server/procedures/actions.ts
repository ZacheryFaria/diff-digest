import { readComments } from "../../lib/store";
import { Channel } from "../channel";
import { openById, os } from "../os";
import type { ServerEvent } from "../../lib/schemas-api";

export const actions = {
    send: os.actions.send.handler(({ input, context }) => {
        const mdPath = openById(context, input.id).entry.mdPath;
        const open = readComments(mdPath).filter(c => c.status === "open" && c.author === "user");
        return context.actions.send({ type: input.type, id: input.id, mdPath, comments: open });
    }),
    wait: os.actions.wait.handler(({ input, context, signal }) =>
        context.actions.wait(input.id, input.timeoutMs, cancel => {
            signal?.addEventListener("abort", cancel, { once: true });
        }),
    ),
    status: os.actions.status.handler(({ input, context }) => context.actions.status(input.id)),
};

export const events = os.events.handler(({ input, context, signal }) => {
    const channel = new Channel<ServerEvent>(() => {
        off();
    });
    const off = context.bus.subscribe(input.id, event => {
        channel.push(event);
    });
    channel.push({ type: "status", status: context.actions.status(input.id) });
    signal?.addEventListener(
        "abort",
        () => {
            channel.close();
        },
        { once: true },
    );
    return (async function* stream(): AsyncGenerator<ServerEvent, void> {
        try {
            yield* channel;
        } finally {
            channel.close();
        }
    })();
});
