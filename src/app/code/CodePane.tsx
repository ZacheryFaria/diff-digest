// The code pane: Diff, After, and Before for one file, with the ⋯ menu.
import { useEffect, useState, type ReactNode } from "react";
import type { DigestPayload } from "../../lib/schemas-api";
import { attempt } from "../state/attempt";
import { useApp, type CodeTarget } from "../state/context";
import { CodeTable } from "./CodeTable";
import { useCode } from "./useCode";

const TABS = [
    { rev: "diff", label: "Diff", title: "The git diff for this file only" },
    { rev: "head", label: "After", title: "The file after the change (this branch)" },
    { rev: "base", label: "Before", title: "The file before the change (the merge-base)" },
] as const;

/** A click anywhere or Escape closes the menu. */
function useDismiss(setOpen: (open: boolean) => void): void {
    useEffect(() => {
        const stop = new AbortController();
        document.addEventListener(
            "click",
            () => {
                setOpen(false);
            },
            { signal: stop.signal },
        );
        document.addEventListener(
            "keydown",
            e => {
                if (e.key === "Escape") setOpen(false);
            },
            { signal: stop.signal },
        );
        return () => {
            stop.abort();
        };
    }, [setOpen]);
}

function Menu({ payload, path }: { readonly payload: DigestPayload; readonly path: string }): ReactNode {
    const { api, id, toast } = useApp();
    const [open, setOpen] = useState(false);
    useDismiss(setOpen);
    const file = payload.files.find(f => f.path === path);
    if (file === undefined || !(file.marked || file.cls === "source" || file.cls === "test")) return null;
    const name = path.split("/").at(-1) ?? path;
    const mark = (): void => {
        setOpen(false);
        attempt(toast, "Could not save", async () => {
            await api.files.setGenerated({ id, path, on: !file.marked });
            toast(file.marked ? `${name} is reviewable again.` : `${name} is marked generated.`);
        });
    };
    return (
        <span className="menu-wrap">
            <button
                type="button"
                title="More actions for this file"
                onClick={e => {
                    e.stopPropagation();
                    setOpen(!open);
                }}
            >
                ⋯
            </button>
            {open ? (
                <div className="menu">
                    <button
                        type="button"
                        onClick={mark}
                        title={
                            file.marked
                                ? "Review this file again in future digests"
                                : "List this file as generated in future digests. Saved in ~/.diff-digest/config.json"
                        }
                    >
                        {file.marked ? "Unmark generated" : "Mark generated"}
                    </button>
                </div>
            ) : null}
        </span>
    );
}

export interface CodePaneProps {
    readonly target: CodeTarget;
    readonly payload: DigestPayload;
    readonly onClose: () => void;
}

export function CodePane({ target, payload, onClose }: CodePaneProps): ReactNode {
    const { api, id, openCode } = useApp();
    const view = useCode(api, id, target);
    const path = view?.path ?? target.path;
    return (
        <aside id="code">
            <div className="code-head">
                <span id="code-path">
                    {path}{" "}
                    {view?.unchanged === true ? (
                        <span className="chip">unchanged from {payload.frontmatter.base.slice(0, 11)}</span>
                    ) : null}
                </span>
                <div className="tabs">
                    {TABS.map(t => (
                        <button
                            key={t.rev}
                            type="button"
                            title={t.title}
                            className={(view?.rev ?? target.rev) === t.rev ? "on" : undefined}
                            onClick={() => {
                                openCode({ ...target, rev: t.rev });
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                    <Menu payload={payload} path={path} />
                    <button type="button" title="Close" onClick={onClose}>
                        ✕
                    </button>
                </div>
            </div>
            <div id="code-body">
                {view === null || view.error === null ? null : <div className="code-error">{view.error}</div>}
                {view === null ? (
                    <p className="loading">Loading…</p>
                ) : (
                    <CodeTable
                        key={`${view.path}:${view.rev}`}
                        rows={view.rows}
                        diff={view.rev === "diff" && !view.unchanged}
                    />
                )}
            </div>
        </aside>
    );
}
