// The meta chips, the listener status, and the action buttons.
import type { ReactNode } from "react";
import type { ActionStatus, DigestPayload } from "../../lib/schemas-api";
import { attempt } from "../state/attempt";
import { useApp } from "../state/context";

export interface ToolbarProps {
    readonly payload: DigestPayload;
    readonly status: ActionStatus | null;
    readonly offline: boolean;
    readonly onPublish: () => void;
    readonly onPostComments: () => void;
}

function Chip({ name, value }: { readonly name: string; readonly value: string }): ReactNode {
    return (
        <span className="chip">
            {name} <b>{value}</b>
        </span>
    );
}

function Meta({ payload }: { readonly payload: DigestPayload }): ReactNode {
    const { stats, frontmatter } = payload;
    const ratio = stats.diffLines === 0 ? 0 : Math.round((stats.digestLines / stats.diffLines) * 100);
    return (
        <div className="meta">
            {frontmatter.pinned ? <Chip name="code" value="pinned" /> : null}
            <Chip name="branch" value={frontmatter.branch === "" ? "—" : frontmatter.branch} />
            <Chip name="base" value={frontmatter.base.slice(0, 11)} />
            <Chip name="head" value={payload.head === null ? "working tree" : payload.head.slice(0, 11)} />
            <Chip name="files" value={`${stats.files} (${stats.generated} generated)`} />
            <Chip name="diff" value={`${stats.diffLines} lines`} />
            <Chip name="digest" value={`${stats.digestLines} lines · ${ratio}%`} />
        </div>
    );
}

function listenText(status: ActionStatus | null, offline: boolean): string {
    if (offline) return "Server offline";
    if (status === null) return "…";
    if (status.listening > 0) return "Claude is listening";
    return status.queued > 0 ? `Queued (${status.queued})` : "Claude is not listening";
}

function sentText(type: "apply" | "review", listening: boolean): string {
    if (!listening) return "Queued. Claude gets it when its wait starts again.";
    return type === "apply" ? "Sent. Claude is applying your comments." : "Sent. A new agent will review the digest.";
}

export function Toolbar({ payload, status, offline, onPublish, onPostComments }: ToolbarProps): ReactNode {
    const { api, id, comments, toast } = useApp();
    const open = comments.filter(c => c.status === "open" && c.author === "user").length;
    const listening = status !== null && status.listening > 0;
    const send = (type: "apply" | "review"): void => {
        attempt(toast, "Could not send", async () => {
            await api.actions.send({ id, type });
            toast(sentText(type, listening));
        });
    };
    return (
        <header id="toolbar">
            <Meta payload={payload} />
            <div className="actions">
                <span className={listening ? "listen on" : "listen"}>{listenText(status, offline)}</span>
                <button
                    type="button"
                    className="primary"
                    disabled={open === 0}
                    onClick={() => {
                        send("apply");
                    }}
                >
                    Apply comments ({open})
                </button>
                <button type="button" disabled={open === 0} onClick={onPostComments}>
                    Post comments…
                </button>
                <button type="button" onClick={onPublish}>
                    Publish…
                </button>
                <button
                    type="button"
                    onClick={() => {
                        send("review");
                    }}
                >
                    Review with agent
                </button>
            </div>
        </header>
    );
}
