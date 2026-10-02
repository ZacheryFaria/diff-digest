// `wait`: block until the user clicks a button in the UI, then print the action and its comments.
import { MAX_WAIT_MS } from "../../lib/limits";
import { WaitResultSchema } from "../../lib/schemas-api";
import type { CliContext } from "../context";
import { emit } from "../output";
import { resolveDigest } from "../ref";
import { runningApi, serverCall } from "../self";
import type { RefFlags } from "./shared";

export interface WaitFlags extends RefFlags {
    readonly timeout: number;
}

export async function wait(this: CliContext, flags: WaitFlags, ref?: string): Promise<void> {
    await emit(
        this.out,
        {
            json: flags.json,
            schema: WaitResultSchema,
            text: r =>
                r.type === "action"
                    ? `ACTION: ${r.action.type}\n${JSON.stringify(r.action, null, 2)}`
                    : `ACTION: timeout\n${JSON.stringify({ type: "timeout" }, null, 2)}`,
        },
        async () => {
            const entry = resolveDigest({ ref, id: flags.id }, this);
            const timeoutMs = Math.min(Math.max(1, Math.round(flags.timeout * 1000)), MAX_WAIT_MS);
            const api = await runningApi(this.home);
            return serverCall(() => api.actions.wait({ id: entry.id, timeoutMs }));
        },
    );
}
