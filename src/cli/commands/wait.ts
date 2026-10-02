// `wait`: block until the user clicks a button in the UI, then print the action and its comments.
import { buildCommand } from "@stricli/core";
import { MAX_WAIT_MS } from "../../lib/contract";
import { WaitResultSchema } from "../../lib/schemas-api";
import type { CliContext } from "../context";
import { emit, jsonFlag } from "../output";
import { resolveDigest } from "../ref";
import { runningApi, serverCall } from "../self";
import { idFlag, refPositional, type RefFlags } from "./shared";

interface WaitFlags extends RefFlags {
    readonly timeout: number;
}

export const waitCommand = buildCommand({
    docs: { brief: "Wait until the user clicks a button in the UI, then print the action and its comments" },
    parameters: {
        flags: {
            json: jsonFlag,
            id: idFlag,
            timeout: {
                kind: "parsed",
                parse: Number,
                brief: "The longest wait in seconds",
                default: String(MAX_WAIT_MS / 1000),
            },
        },
        positional: refPositional,
    },
    async func(this: CliContext, flags: WaitFlags, ref?: string) {
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
    },
});
