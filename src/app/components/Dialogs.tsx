// The publish dialog and the post-comments dialog: choose backends, preview, then post.
import { useEffect, useState, type ReactNode } from "react";
import type { PublishReport } from "../../lib/publish/schemas";
import { reviewMarkdown } from "../../lib/review";
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

export function reportSummary(report: PublishReport): string {
    const done = report.results.map(r => `${r.updated ? "updated" : "posted"} ${r.backend}`);
    const skipped = report.skipped.map(s => `skipped ${s}`);
    const failed = report.errors.map(e => `${e.backend} failed: ${e.message}`);
    const all = [...done, ...skipped, ...failed];
    return all.length === 0 ? "No backend. Choose one, or set publishTo in the config." : all.join("; ");
}

function useChosen(): { readonly chosen: readonly string[]; readonly toggle: (name: string) => void } {
    const [chosen, setChosen] = useState<readonly string[]>([]);
    const toggle = (name: string): void => {
        setChosen(old => (old.includes(name) ? old.filter(n => n !== name) : [...old, name]));
    };
    return { chosen, toggle };
}

function usePublish(onClose: () => void): {
    readonly preview: string | null;
    readonly run: (to: readonly string[], options: { readonly dryRun: boolean; readonly force: boolean }) => void;
} {
    const { api, id, toast } = useApp();
    const [preview, setPreview] = useState<string | null>(null);
    const run = (
        to: readonly string[],
        { dryRun, force }: { readonly dryRun: boolean; readonly force: boolean },
    ): void => {
        attempt(toast, "Could not publish", async () => {
            const report = await api.publish.digest({ id, to: [...to], force, dryRun });
            const previews = report.previews.map(p => `--- ${p.backend} ---\n${p.text}`).join("\n\n");
            if (dryRun) setPreview(previews === "" ? reportSummary(report) : previews);
            else {
                toast(reportSummary(report), report.results[0]?.ref);
                onClose();
            }
        });
    };
    return { preview, run };
}

export function PublishDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
    const backends = useBackends();
    const { chosen, toggle } = useChosen();
    const { preview, run } = usePublish(onClose);
    const [force, setForce] = useState(false);
    return (
        <div className="overlay" role="dialog" aria-label="Publish the digest">
            <div className="dialog">
                <div className="dialog-head">
                    <b>Publish the digest</b>{" "}
                    <span className="dialog-note">No backend chosen: publishTo in the config.</span>
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
                <div className="row">
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            run(chosen, { dryRun: true, force });
                        }}
                    >
                        Preview
                    </button>
                    <button
                        type="button"
                        className="primary"
                        onClick={() => {
                            run(chosen, { dryRun: false, force });
                        }}
                    >
                        Publish
                    </button>
                </div>
            </div>
        </div>
    );
}

export function PostCommentsDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
    const { api, id, comments, toast } = useApp();
    const backends = useBackends();
    const { chosen, toggle } = useChosen();
    const post = (): void => {
        attempt(toast, "Could not post", async () => {
            const report = await api.publish.review({ id, to: [...chosen] });
            toast(reportSummary(report), report.results[0]?.ref);
            onClose();
        });
    };
    return (
        <div className="overlay" role="dialog" aria-label="Post the comments">
            <div className="dialog">
                <div className="dialog-head">
                    <b>Post your open comments as one review</b>
                </div>
                <Picker backends={backends} chosen={chosen} onToggle={toggle} />
                <textarea readOnly value={reviewMarkdown(comments)} />
                <div className="row">
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="button" className="primary" onClick={post}>
                        Post
                    </button>
                </div>
            </div>
        </div>
    );
}
