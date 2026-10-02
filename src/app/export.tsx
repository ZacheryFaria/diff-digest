// The entry for a static export: the payload is in the page, and the client is read-only.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { exportLinks } from "./export-links";
import { readPayload, staticApi } from "./static-api";

const root = document.querySelector("#root");
const payload = readPayload(document.querySelector("#digest-payload")?.textContent ?? "");
if (root !== null) {
    createRoot(root).render(
        <StrictMode>
            {payload === null ? (
                <p className="error">This export has no digest in it.</p>
            ) : (
                <App
                    api={staticApi(payload)}
                    id={payload.digest.id}
                    follow={false}
                    initialCode={null}
                    exported={exportLinks(payload)}
                />
            )}
        </StrictMode>,
    );
}
