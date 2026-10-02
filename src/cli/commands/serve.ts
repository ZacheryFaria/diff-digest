// `serve`: start the review server if needed, register the digest, and print its URL.
import { ensureServer } from "../../server/lifecycle";
import type { CliContext } from "../context";
import { emit } from "../output";
import { ServeOutputSchema } from "../outputs";
import { resolveDigest } from "../ref";
import { digestUrl, selfCommand } from "../self";
import type { RefFlags } from "./shared";

export interface ServeFlags extends RefFlags {
    readonly open: boolean;
}

export async function serve(this: CliContext, flags: ServeFlags, ref?: string): Promise<void> {
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
}
