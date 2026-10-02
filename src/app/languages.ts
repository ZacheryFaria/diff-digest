// The highlight.js languages, by file extension (part 1 of the registered languages).
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import { MORE_LANGUAGES } from "./languages-more";

export const LANGUAGE_MODULES = { bash, css, go, java, javascript, json, ...MORE_LANGUAGES } as const;

const BY_EXTENSION: Readonly<Record<string, string>> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    js: "javascript",
    mjs: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    yml: "yaml",
    yaml: "yaml",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    md: "markdown",
    sh: "bash",
    bzl: "python",
    bazel: "python",
};

export function languageFor(path: string): string | null {
    return BY_EXTENSION[path.split(".").at(-1) ?? ""] ?? null;
}
