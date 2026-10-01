// `serve`: start the review server if needed, register the digest, and print its URL.
import { buildCommand } from "@stricli/core";
import { ensureServer } from "../../server/lifecycle";
import type { CliContext } from "../context";
import { emit, jsonFlag } from "../output";
import { ServeOutputSchema } from "../outputs";
import { resolveDigest } from "../ref";
import { digestUrl, selfCommand } from "../self";
import { idFlag, refPositional, type RefFlags } from "./shared";

interface ServeFlags extends RefFlags {
    readonly open: boolean;
}

export const serveCommand = buildCommand({
    docs: { brief: "Start the review server if it is not running, register the digest, and print its URL" },
    parameters: {
        flags: {
            json: jsonFlag,
            id: idFlag,
            open: { kind: "boolean", brief: "Open the URL in the browser", default: false },
        },
        positional: refPositional,
    },
    async func(this: CliContext, flags: ServeFlags, ref?: string) {
        await emit(this.out, { json: flags.json, schema: ServeOutputSchema, text: r => r.url }, async () => {
            const entry = resolveDigest({ ref, id: flags.id }, this);
            const info = await ensureServer(selfCommand(), this.home);
            const url = digestUrl(info.port, entry.id);
            if (flags.open)
                Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url], {
                    stdout: "ignore",
                    stderr: "ignore",
                }).unref();
            return { url, id: entry.id, pid: info.pid };
        });
    },
});
