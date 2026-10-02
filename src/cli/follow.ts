// `server logs -f`: print the lines that the server adds to its log, until Ctrl-C.
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

export const FOLLOW_MS = 250;

/** The text from `offset` to the end of the file, and the new offset. A shorter file starts again at 0. */
export function readFrom(path: string, offset: number): { readonly text: string; readonly offset: number } {
    if (!existsSync(path)) return { text: "", offset: 0 };
    const size = statSync(path).size;
    const start = size < offset ? 0 : offset;
    if (size === start) return { text: "", offset: start };
    const buffer = Buffer.alloc(size - start);
    const fd = openSync(path, "r");
    try {
        readSync(fd, buffer, 0, buffer.length, start);
    } finally {
        closeSync(fd);
    }
    return { text: buffer.toString("utf8"), offset: size };
}

/** Prints each full line that is added after `offset`. Resolves when `stop()` resolves. */
export async function followLog(
    path: string,
    offset: number,
    print: (line: string) => void,
    stop: () => Promise<void>,
): Promise<void> {
    let at = offset;
    let partial = "";
    const timer = setInterval(() => {
        const next = readFrom(path, at);
        at = next.offset;
        const lines = (partial + next.text).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) print(line);
    }, FOLLOW_MS);
    await stop();
    clearInterval(timer);
}
