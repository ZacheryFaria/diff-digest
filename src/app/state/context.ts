// What every component needs: the API, the digest id, and the actions that change the page.
import { createContext, useContext } from "react";
import type { ApiClient } from "../../lib/client";
import type { Comment, CommentTarget } from "../../lib/schemas";

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
    readonly openCode: (target: CodeTarget) => void;
    readonly toast: (text: string, url?: string) => void;
}

export const AppContext = createContext<AppActions | null>(null);

export function useApp(): AppActions {
    const app = useContext(AppContext);
    if (app === null) throw new Error("useApp needs an AppContext provider.");
    return app;
}
