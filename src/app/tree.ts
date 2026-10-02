// The changed files as a folder tree (ported from ui/app.js `renderTree`).
import type { MarkedFile } from "../lib/schemas-api";

export type TreeFile = MarkedFile & { readonly name: string };

export interface TreeDir {
    readonly label: string;
    readonly dirs: readonly TreeDir[];
    readonly files: readonly TreeFile[];
}

interface Entry {
    /** The path parts that are left below this folder. */
    readonly parts: readonly string[];
    readonly file: MarkedFile;
}

function dirOf(label: string, entries: readonly Entry[]): TreeDir {
    const files: TreeFile[] = [];
    const groups = new Map<string, Entry[]>();
    for (const { parts, file } of entries) {
        const [head = "", ...rest] = parts;
        if (rest.length === 0) files.push({ ...file, name: head });
        else groups.set(head, [...(groups.get(head) ?? []), { parts: rest, file }]);
    }
    const dirs = [...groups.keys()]
        .toSorted((a, b) => a.localeCompare(b))
        .map(name => dirOf(name, groups.get(name) ?? []));
    const only = dirs[0];
    // A folder that holds only one folder is joined with it, as GitHub does.
    if (label !== "" && files.length === 0 && dirs.length === 1 && only !== undefined) {
        return { ...only, label: `${label}/${only.label}` };
    }
    return { label, dirs, files: files.toSorted((a, b) => a.name.localeCompare(b.name)) };
}

export function buildTree(files: readonly MarkedFile[]): TreeDir {
    return dirOf(
        "",
        files.map(file => ({ parts: file.path.split("/"), file })),
    );
}
