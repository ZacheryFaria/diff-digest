// The static export bundle. A Bun macro: `bun build --compile` runs `buildExportBundle` once and puts the
// result inside the binary. From source, Bun runs it when this file loads (only for `export`).
import { buildExportBundle } from "./export-bundle" with { type: "macro" };

export const EXPORT_BUNDLE = buildExportBundle();
