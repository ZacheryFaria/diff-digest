// `export`: one static HTML file with the digest, the meta, and the file tree (no code pane, no comments).
import { resolve } from "node:path";
import { writeAtomic } from "../../lib/store";
import type { CliContext } from "../context";
import { exportPage } from "../export-html";
import { emit } from "../output";
import { ExportOutputSchema } from "../outputs";
import { resolveDigest } from "../ref";
import type { RefFlags } from "./shared";

export interface ExportFlags extends RefFlags {
    readonly out?: string;
    readonly open: boolean;
}

export async function exportDigest(this: CliContext, flags: ExportFlags, ref?: string): Promise<void> {
    await emit(this.out, { json: flags.json, schema: ExportOutputSchema, text: r => r.path }, () => {
        const entry = resolveDigest({ ref, id: flags.id }, this);
        const html = exportPage(entry, this.home);
        const path = flags.out === undefined ? entry.mdPath.replace(/\.md$/u, ".html") : resolve(this.cwd, flags.out);
        writeAtomic(path, html);
        if (flags.open)
            Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", path], {
                stdout: "ignore",
                stderr: "ignore",
            }).unref();
        return { path };
    });
}
