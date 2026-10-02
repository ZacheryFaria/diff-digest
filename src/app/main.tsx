import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { codeFromHash, digestIdFromPath, liveFromSearch, pageApi } from "./api";

const root = document.querySelector("#root");
const id = digestIdFromPath(location.pathname);
if (root !== null) {
    createRoot(root).render(
        <StrictMode>
            {id === null ? (
                <p className="error">This page needs a digest id in its URL.</p>
            ) : (
                <App
                    api={pageApi(location.origin)}
                    id={id}
                    follow={liveFromSearch(location.search)}
                    initialCode={codeFromHash(location.hash)}
                    exported={null}
                />
            )}
        </StrictMode>,
    );
}
