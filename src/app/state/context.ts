// What every component needs: the API, the digest id, and the actions that change the page.
import { createContext, useContext } from "react";
import type { ApiClient } from "../../lib/client";
import type { Comment, CommentTarget } from "../../lib/schemas";
import type { ExportLinks } from "../export-links";

export interface CodeTarget {
    readonly path: string;
    readonly start?: number;
    readonly end?: number;
    readonly rev: "diff" | "head" | "base";
}

export interface AppActions {
    readonly api: ApiClient;
    readonly id: string;
    readonly comments: readonly Comment[];
    readonly addComment: (target: CommentTarget, body: string) => Promise<void>;
    readonly removeComment: (commentId: string) => Promise<void>;
    /** The path of the open code target (as the digest anchor wrote it), or null. */
    readonly codePath: string | null;
    readonly openCode: (target: CodeTarget) => void;
    readonly toast: (text: string, url?: string) => void;
    /** A static export: no writes, and anchors link to the repo web page. Null on the live page. */
    readonly exported: ExportLinks | null;
}

export const AppContext = createContext<AppActions | null>(null);

export function useApp(): AppActions {
    const app = useContext(AppContext);
    if (app === null) throw new Error("useApp needs an AppContext provider.");
    return app;
}
