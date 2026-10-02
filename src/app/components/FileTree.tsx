// The changed files as a folder tree. A click opens the file's diff.
import { useMemo, type ReactNode } from "react";
import { matchesPath } from "../../lib/digest";
import type { MarkedFile } from "../../lib/schemas-api";
import { useApp } from "../state/context";
import { buildTree, type TreeDir, type TreeFile } from "../tree";

/** `active` is the open path; a digest anchor can be a path suffix, as the server reads it. */
function FileLabel({ file }: { readonly file: TreeFile }): ReactNode {
    return (
        <>
            <span className={`status s-${file.status}`}>{file.status}</span>
            <span className="name">{file.name}</span>
            <span className="cls">{file.marked ? "marked" : file.cls}</span>
        </>
    );
}

/** In a static export, a file links to the repo web page, or is plain text. */
function ExportedFile({ file, href }: { readonly file: TreeFile; readonly href: string | null }): ReactNode {
    return href === null ? (
        <span className="row">
            <FileLabel file={file} />
        </span>
    ) : (
        <a className="row" href={href} target="_blank" rel="noreferrer">
            <FileLabel file={file} />
        </a>
    );
}

function FileRow({ file, active }: { readonly file: TreeFile; readonly active: string | null }): ReactNode {
    const { openCode, exported } = useApp();
    const open = (): void => {
        openCode({ path: file.path, rev: file.status === "D" ? "base" : "diff" });
    };
    return (
        <li
            className={`file ${file.cls}${active !== null && matchesPath(file.path, active) ? " active" : ""}`}
            title={file.oldPath === file.path ? file.path : `${file.oldPath} → ${file.path}`}
        >
            {exported === null ? (
                <button type="button" onClick={open}>
                    <FileLabel file={file} />
                </button>
            ) : (
                <ExportedFile file={file} href={exported.linkFor(file.path)} />
            )}
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
