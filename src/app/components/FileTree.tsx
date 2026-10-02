// The changed files as a folder tree. A click opens the file's diff.
import { useMemo, type ReactNode } from "react";
import type { MarkedFile } from "../../lib/schemas-api";
import { useApp } from "../state/context";
import { buildTree, type TreeDir, type TreeFile } from "../tree";

function FileRow({ file, active }: { readonly file: TreeFile; readonly active: string | null }): ReactNode {
    const { openCode } = useApp();
    const open = (): void => {
        openCode({ path: file.path, rev: file.status === "D" ? "base" : "diff" });
    };
    return (
        <li
            className={`file ${file.cls}${active === file.path ? " active" : ""}`}
            title={file.oldPath === file.path ? file.path : `${file.oldPath} → ${file.path}`}
        >
            <button type="button" onClick={open}>
                <span className={`status s-${file.status}`}>{file.status}</span>
                <span className="name">{file.name}</span>
                <span className="cls">{file.marked ? "marked" : file.cls}</span>
            </button>
        </li>
    );
}

function Dir({ dir, active }: { readonly dir: TreeDir; readonly active: string | null }): ReactNode {
    return (
        <ul>
            {dir.dirs.map(d => (
                <li key={d.label}>
                    <div className="dir">{d.label}/</div>
                    <Dir dir={d} active={active} />
                </li>
            ))}
            {dir.files.map(f => (
                <FileRow key={f.path} file={f} active={active} />
            ))}
        </ul>
    );
}

export function FileTree({
    files,
    active,
}: {
    readonly files: readonly MarkedFile[];
    readonly active: string | null;
}): ReactNode {
    const tree = useMemo(() => buildTree(files), [files]);
    return (
        <nav id="files">
            <div className="files-head">Files</div>
            <div id="tree">
                <Dir dir={tree} active={active} />
            </div>
        </nav>
    );
}
