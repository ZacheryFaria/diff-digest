// One static HTML file: the styles, the payload as JSON, and the script, all inline. Nothing loads from the network.
import { buildModel } from "../lib/model";
import { digestPayload, openDigest } from "../lib/payload";
import { originRepo, type OriginRepo } from "../lib/repo";
import type { RegistryEntry, StaticPayload } from "../lib/schemas-api";
import { EXPORT_BUNDLE } from "./export-assets";
import type { ExportBundle } from "./export-bundle";

function escapeHtml(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** The repo web URL for a known origin, or null. */
export function webUrl(origin: OriginRepo | null): string | null {
    return origin === null ? null : `https://${origin.host}/${origin.owner}/${origin.repo}`;
}

/**
 * True when an inline script cannot hold the HTML parser in its "double-escaped" state: after `<!--`, a
 * `<script` before the next `-->` makes the real `</script>` not end the element.
 */
export function inlineScriptSafe(js: string): boolean {
    const lower = js.toLowerCase();
    let at = lower.indexOf("<!--");
    while (at !== -1) {
        const end = lower.indexOf("-->", at + 4);
        const open = /<script[\s/>]/u.exec(lower.slice(at + 4, end === -1 ? undefined : end));
        if (open !== null) return false;
        at = end === -1 ? -1 : lower.indexOf("<!--", end + 3);
    }
    return true;
}

/** `<` in the JSON and `</script` in the script cannot end their script element early. */
export function exportHtml(payload: StaticPayload, bundle: ExportBundle): string {
    const title = (buildModel(payload.digest.body).title?.text ?? "Diff digest").replaceAll("`", "");
    const json = JSON.stringify(payload).replaceAll("<", "\\u003c");
    const js = bundle.js.replaceAll(/<\/(script)/giu, "<\\/$1");
    const css = bundle.css.replaceAll(/<\/(style)/giu, "<\\/$1");
    if (!inlineScriptSafe(js))
        throw new Error("The export script has `<!--` and then `<script`, so it cannot be inline.");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:," />
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script id="digest-payload" type="application/json">${json}</script>
<script type="module">${js}</script>
</body>
</html>
`;
}

/** The export page for a digest. The old export had no comments, and this one has none. */
export function exportPage(entry: RegistryEntry, home: string): string {
    const digest = digestPayload(openDigest(entry, home));
    return exportHtml({ digest, comments: [], repoUrl: webUrl(originRepo(entry.root)) }, EXPORT_BUNDLE);
}
