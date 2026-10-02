// The digest id from the page URL (`/d/<id>/`), and the typed client for this server.
import { createApiClient, type ApiClient } from "../lib/client";

export function digestIdFromPath(pathname: string): string | null {
    return /^\/d\/([0-9a-z]{8})\/?$/u.exec(pathname)?.[1] ?? null;
}

export function pageApi(origin: string): ApiClient {
    return createApiClient(new URL("/rpc", origin).toString());
}
