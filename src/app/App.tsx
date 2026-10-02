// The page: the toolbar, the file tree, the digest, and the code pane, with the shared actions in context.
import { useState, type ReactNode } from "react";
import type { ApiClient } from "../lib/client";
import { PostCommentsDialog, PublishDialog } from "./components/Dialogs";
import { Page } from "./components/Page";
import { Toast } from "./components/Toast";
import { Toolbar } from "./components/Toolbar";
import { useActions } from "./state/actions";
import { AppContext } from "./state/context";
import { useLive } from "./state/live";

export interface AppProps {
    readonly api: ApiClient;
    readonly id: string;
}

type Dialog = "publish" | "comments" | null;

export function App({ api, id }: AppProps): ReactNode {
    const live = useLive(api, id);
    const { actions, code, setCode, message, clearMessage } = useActions(api, id, live);
    const [dialog, setDialog] = useState<Dialog>(null);
    const close = (): void => {
        setDialog(null);
    };
    if (live.payload === null)
        return <p className={live.error === null ? "loading" : "error"}>{live.error ?? "Loading…"}</p>;
    return (
        <AppContext value={actions}>
            <Toolbar
                payload={live.payload}
                status={live.status}
                offline={live.offline}
                onPublish={() => {
                    setDialog("publish");
                }}
                onPostComments={() => {
                    setDialog("comments");
                }}
            />
            <Page
                payload={live.payload}
                code={code}
                onCloseCode={() => {
                    setCode(null);
                }}
            />
            {dialog === "publish" ? <PublishDialog onClose={close} /> : null}
            {dialog === "comments" ? <PostCommentsDialog onClose={close} /> : null}
            <Toast message={message} onDone={clearMessage} />
        </AppContext>
    );
}
