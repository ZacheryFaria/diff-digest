// The digest id from the page URL (`/d/<id>/`), and the typed client for this server.
import { createApiClient, type ApiClient } from "../lib/client";

export function digestIdFromPath(pathname: string): string | null {
    return /^\/d\/([0-9a-z]{8})\/?$/u.exec(pathname)?.[1] ?? null;
}

/** The code pane target of a `#code=path[:start[-end]]` deep link. It opens in the Diff view. */
export interface DeepLink {
    readonly path: string;
    readonly rev: "diff";
    readonly start?: number;
    readonly end?: number;
}

const DEEP_LINK = /^#code=(.+?)(?::(\d+)(?:-(\d+))?)?$/u;

function decoded(text: string): string | null {
    try {
        return decodeURIComponent(text);
    } catch {
        return null;
    }
}

export function codeFromHash(hash: string): DeepLink | null {
    const match = DEEP_LINK.exec(hash);
    const path = match === null ? null : decoded(match[1] ?? "");
    if (match === null || path === null || path === "") return null;
    const [, , startText, endText] = match;
    if (startText === undefined) return { path, rev: "diff" };
    const start = Number(startText);
    return { path, rev: "diff", start, end: endText === undefined ? start : Number(endText) };
}

/** `?live=0` loads the page once and opens no event stream (for a headless screenshot). */
export function liveFromSearch(search: string): boolean {
    return new URLSearchParams(search).get("live") !== "0";
}

export function pageApi(origin: string): ApiClient {
    return createApiClient(new URL("/rpc", origin).toString());
}
