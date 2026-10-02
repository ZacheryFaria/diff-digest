// The three panes: the file tree, the digest, and the code pane when a file is open.
import type { ReactNode } from "react";
import type { DigestPayload } from "../../lib/schemas-api";
import { CodePane } from "../code/CodePane";
import { useApp, type CodeTarget } from "../state/context";
import { DigestView } from "./Digest";
import { FileTree } from "./FileTree";

export function Page(props: {
    readonly payload: DigestPayload;
    readonly code: CodeTarget | null;
    readonly onCloseCode: () => void;
}): ReactNode {
    const { payload, code, onCloseCode } = props;
    const { comments } = useApp();
    return (
        <div id="layout">
            <FileTree files={payload.files} active={code?.path ?? null} />
            <main id="digest">
                <DigestView body={payload.body} lineOffset={payload.lineOffset} comments={comments} />
            </main>
            {code === null ? null : <CodePane target={code} payload={payload} onClose={onCloseCode} />}
        </div>
    );
}
