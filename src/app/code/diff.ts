// A unified diff as rows for the Diff view (ported from ui/app.js `diffTable`).

export type DiffRow =
    | { readonly kind: "hunk"; readonly text: string; readonly newStart: number; readonly newEnd: number }
    | {
          readonly kind: "line";
          readonly sign: " " | "+" | "-";
          readonly oldN: number | null;
          readonly newN: number | null;
          readonly text: string;
      };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u;

/** One diff line as a row, and the old and new line numbers after it. */
function lineRow(
    line: string,
    oldN: number,
    newN: number,
): { readonly row: DiffRow | null; readonly oldN: number; readonly newN: number } {
    const sign = line.charAt(0);
    if (sign !== " " && sign !== "+" && sign !== "-") return { row: null, oldN, newN };
    const row: DiffRow = {
        kind: "line",
        sign,
        oldN: sign === "+" ? null : oldN,
        newN: sign === "-" ? null : newN,
        text: line.slice(1),
    };
    return { row, oldN: sign === "+" ? oldN : oldN + 1, newN: sign === "-" ? newN : newN + 1 };
}

export function diffRows(text: string): DiffRow[] {
    const rows: DiffRow[] = [];
    let oldN = 0;
    let newN = 0;
    let inHeader = false;
    for (const line of text.split("\n")) {
        if (line.startsWith("diff ")) {
            inHeader = true;
            continue;
        }
        const hunk = HUNK.exec(line);
        if (hunk !== null) {
            const [, oldStart = "0", newStart = "0", newCount] = hunk;
            inHeader = false;
            oldN = Number(oldStart);
            newN = Number(newStart);
            const end = newN + (newCount === undefined ? 1 : Number(newCount)) - 1;
            rows.push({ kind: "hunk", text: line, newStart: newN, newEnd: end });
            continue;
        }
        if (inHeader || line === "\\ No newline at end of file") continue;
        const next = lineRow(line, oldN, newN);
        ({ oldN, newN } = next);
        if (next.row !== null) rows.push(next.row);
    }
    return rows;
}
