// Load the rows of the code pane for one target.
import { useEffect, useState } from "react";
import type { ApiClient } from "../../lib/client";
import type { FileSide } from "../../lib/schemas-api";
import { errorText } from "../state/attempt";
import type { CodeTarget } from "../state/context";
import { diffView, fileView, type ViewRow } from "./rows";

export interface CodeView {
    /** The path the server found (a digest anchor can be a path suffix). */
    readonly path: string;
    /** The view on screen: a file with no diff shows its After view. */
    readonly rev: CodeTarget["rev"];
    readonly rows: readonly ViewRow[];
    readonly unchanged: boolean;
    readonly error: string | null;
}

async function loadFile(api: ApiClient, id: string, target: CodeTarget, rev: FileSide): Promise<CodeView> {
    const file = await api.files.read({ id, path: target.path, rev });
    const error = file.text === "" ? (file.error ?? "Empty file") : null;
    const rows = fileView(file, { start: target.start, end: target.end });
    return { path: file.path, rev, rows, unchanged: file.unchanged, error };
}

async function loadView(api: ApiClient, id: string, target: CodeTarget): Promise<CodeView> {
    if (target.rev !== "diff") return loadFile(api, id, target, target.rev);
    const diff = await api.files.diff({ id, path: target.path });
    if (diff.text === "") return { ...(await loadFile(api, id, target, "head")), unchanged: true };
    const rows = diffView(diff, { start: target.start, end: target.end });
    return { path: diff.path, rev: "diff", rows, unchanged: false, error: null };
}

function failed(target: CodeTarget, e: unknown): CodeView {
    return { path: target.path, rev: target.rev, rows: [], unchanged: false, error: errorText(e) };
}

export function useCode(api: ApiClient, id: string, target: CodeTarget): CodeView | null {
    const [view, setView] = useState<CodeView | null>(null);
    useEffect(() => {
        let live = true;
        const show = (v: CodeView): void => {
            if (live) setView(v);
        };
        loadView(api, id, target).then(show, (e: unknown) => {
            show(failed(target, e));
        });
        return () => {
            live = false;
        };
    }, [api, id, target]);
    return view;
}
