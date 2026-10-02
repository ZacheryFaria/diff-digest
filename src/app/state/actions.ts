// The shared actions: comment writes (then a fresh comment list), the open code target, and the toast.
import { useCallback, useMemo, useState } from "react";
import type { ApiClient } from "../../lib/client";
import type { CommentTarget } from "../../lib/schemas";
import type { ToastMessage } from "../components/Toast";
import type { AppActions, CodeTarget } from "./context";
import type { Live } from "./live";

export function useActions(
    api: ApiClient,
    id: string,
    live: Live,
    initialCode: CodeTarget | null,
): {
    readonly actions: AppActions;
    readonly code: CodeTarget | null;
    readonly setCode: (code: CodeTarget | null) => void;
    readonly message: ToastMessage | null;
    readonly clearMessage: () => void;
} {
    const [code, setCode] = useState<CodeTarget | null>(initialCode);
    const [message, setMessage] = useState<ToastMessage | null>(null);
    const { comments, reloadComments } = live;
    const clearMessage = useCallback(() => {
        setMessage(null);
    }, []);
    const actions = useMemo<AppActions>(
        () => ({
            api,
            id,
            comments,
            addComment: async (target: CommentTarget, body: string) => {
                await api.comments.add({ id, target, body });
                reloadComments();
            },
            removeComment: async (commentId: string) => {
                await api.comments.remove({ id, commentId });
                reloadComments();
            },
            codePath: code?.path ?? null,
            openCode: setCode,
            toast: (text: string, url?: string) => {
                setMessage({ text, url, at: Date.now() });
            },
        }),
        [api, id, comments, reloadComments, code],
    );
    return { actions, code, setCode, message, clearMessage };
}
