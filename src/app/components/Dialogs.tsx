// The publish dialog and the post-comments dialog: choose backends, preview, then post.
import { useEffect, useState, type ReactNode } from "react";
import type { PublishReport } from "../../lib/publish/schemas";
import { reviewMarkdown } from "../../lib/review";
import { isEmptyReport, reportSummary } from "../publish-report";
import { attempt } from "../state/attempt";
import { useApp } from "../state/context";

interface BackendInfo {
    readonly name: string;
    readonly type: "github" | "local";
}

function useBackends(): readonly BackendInfo[] {
    const { api, id } = useApp();
    const [backends, setBackends] = useState<readonly BackendInfo[]>([]);
    useEffect(() => {
        api.publish.backends({ id }).then(setBackends, () => {
            setBackends([]);
        });
    }, [api, id]);
    return backends;
}

function Picker({
    backends,
    chosen,
    onToggle,
}: {
    readonly backends: readonly BackendInfo[];
    readonly chosen: readonly string[];
    readonly onToggle: (name: string) => void;
}): ReactNode {
    return (
        <div className="backends">
            {backends.map(b => (
                <label key={b.name}>
                    <input
                        type="checkbox"
                        checked={chosen.includes(b.name)}
                        onChange={() => {
                            onToggle(b.name);
                        }}
                    />{" "}
                    {b.name} <span className="chip">{b.type}</span>
                </label>
            ))}
        </div>
    );
}

/** Escape closes the dialog. */
function useEscape(onClose: () => void): void {
    useEffect(() => {
        const stop = new AbortController();
        document.addEventListener(
            "keydown",
            e => {
                if (e.key === "Escape") onClose();
            },
            { signal: stop.signal },
        );
        return () => {
            stop.abort();
        };
    }, [onClose]);
}

/** A click on the overlay (not in the dialog) closes the dialog. */
function overlayClick(onClose: () => void): (e: { readonly target: unknown; readonly currentTarget: unknown }) => void {
    return e => {
        if (e.target === e.currentTarget) onClose();
    };
}

/** One request at a time: the buttons are off while a request runs, so a double click posts once. */
function useBusy(): {
    readonly busy: boolean;
    readonly run: (what: string, task: () => Promise<void>) => void;
} {
    const { toast } = useApp();
    const [busy, setBusy] = useState(false);
    const run = (what: string, task: () => Promise<void>): void => {
        if (busy) return;
        setBusy(true);
        attempt(toast, what, async () => {
            try {
                await task();
            } finally {
                setBusy(false);
            }
        });
    };
    return { busy, run };
}

/** Shows the report. The dialog stays open when no backend was used, so the user can choose one. */
function useReport(onClose: () => void): (report: PublishReport) => void {
    const { toast } = useApp();
    return report => {
        toast(reportSummary(report), report.results[0]?.ref);
        if (!isEmptyReport(report)) onClose();
    };
}

function useChosen(): { readonly chosen: readonly string[]; readonly toggle: (name: string) => void } {
    const [chosen, setChosen] = useState<readonly string[]>([]);
    const toggle = (name: string): void => {
        setChosen(old => (old.includes(name) ? old.filter(n => n !== name) : [...old, name]));
    };
    return { chosen, toggle };
}

interface PublishOptions {
    readonly dryRun: boolean;
    readonly force: boolean;
}

function usePublish(onClose: () => void): {
    readonly preview: string | null;
    readonly busy: boolean;
    readonly publish: (to: readonly string[], options: PublishOptions) => void;
} {
    const { api, id } = useApp();
    const [preview, setPreview] = useState<string | null>(null);
    const { busy, run } = useBusy();
    const report = useReport(onClose);
    const publish = (to: readonly string[], { dryRun, force }: PublishOptions): void => {
        run("Could not publish", async () => {
            const result = await api.publish.digest({ id, to: [...to], force, dryRun });
            const previews = result.previews.map(p => `--- ${p.backend} ---\n${p.text}`).join("\n\n");
            if (dryRun) setPreview(previews === "" ? reportSummary(result) : previews);
            else report(result);
        });
    };
    return { preview, busy, publish };
}

function Buttons(props: {
    readonly busy: boolean;
    readonly onClose: () => void;
    readonly onPreview?: () => void;
    readonly primary: string;
    readonly onPrimary: () => void;
}): ReactNode {
    const { busy, onClose, onPreview, primary, onPrimary } = props;
    return (
        <div className="row">
            <button type="button" onClick={onClose}>
                Cancel
            </button>
            {onPreview === undefined ? null : (
                <button type="button" disabled={busy} onClick={onPreview}>
                    Preview
                </button>
            )}
            <button type="button" className="primary" disabled={busy} onClick={onPrimary}>
                {busy ? "Working…" : primary}
            </button>
        </div>
    );
}

const BACKEND_NOTE = "If you choose no backend, the backends in publishTo are used.";

export function PublishDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
    const backends = useBackends();
    const { chosen, toggle } = useChosen();
    const { preview, busy, publish } = usePublish(onClose);
    const [force, setForce] = useState(false);
    useEscape(onClose);
    return (
        <div className="overlay" role="dialog" aria-label="Publish the digest" onClick={overlayClick(onClose)}>
            <div className="dialog">
                <div className="dialog-head">
                    <b>Publish the digest</b> <span className="dialog-note">{BACKEND_NOTE}</span>
                </div>
                <Picker backends={backends} chosen={chosen} onToggle={toggle} />
                <label className="options">
                    <input
                        type="checkbox"
                        checked={force}
                        onChange={() => {
                            setForce(!force);
                        }}
                    />{" "}
                    Publish even with lint errors
                </label>
                {preview === null ? null : <textarea readOnly value={preview} />}
                <Buttons
                    busy={busy}
                    onClose={onClose}
                    onPreview={() => {
                        publish(chosen, { dryRun: true, force });
                    }}
                    primary="Publish"
                    onPrimary={() => {
                        publish(chosen, { dryRun: false, force });
                    }}
                />
            </div>
        </div>
    );
}

export function PostCommentsDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
    const { api, id, comments } = useApp();
    const backends = useBackends();
    const { chosen, toggle } = useChosen();
    const { busy, run } = useBusy();
    const report = useReport(onClose);
    useEscape(onClose);
    const post = (): void => {
        run("Could not post", async () => {
            report(await api.publish.review({ id, to: [...chosen] }));
        });
    };
    return (
        <div className="overlay" role="dialog" aria-label="Post the comments" onClick={overlayClick(onClose)}>
            <div className="dialog">
                <div className="dialog-head">
                    <b>Post your open comments as one review</b> <span className="dialog-note">{BACKEND_NOTE}</span>
                </div>
                <Picker backends={backends} chosen={chosen} onToggle={toggle} />
                <textarea readOnly value={reviewMarkdown(comments)} />
                <Buttons busy={busy} onClose={onClose} primary="Post" onPrimary={post} />
            </div>
        </div>
    );
}
