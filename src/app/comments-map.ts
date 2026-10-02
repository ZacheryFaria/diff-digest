// Which digest block each comment shows under. Pure: the digest view and the tests use it.
import type { Block } from "../lib/md";
import type { ModelBlock } from "../lib/model";
import type { Comment } from "../lib/schemas";

type TableBlock = Extract<Block, { kind: "table" }>;

/** A table row's body line: the header and the delimiter come first. */
export function tableRowLine(table: TableBlock, row: number): number {
    return table.line + 2 + row;
}

/** File line → the model block on that line. */
export function blockIndex(blocks: readonly ModelBlock[]): (fileLine: number) => ModelBlock | undefined {
    const byLine = new Map(blocks.map(b => [b.line, b]));
    return line => byLine.get(line);
}

export interface DigestComments {
    /** Block file line → the comments under that block. */
    readonly byBlock: ReadonlyMap<number, readonly Comment[]>;
    /** Code comments, and digest comments whose cid no block has (the text changed). */
    readonly others: readonly Comment[];
}

/** The block for a comment: the cid must match; `line` only chooses between equal cids (exact, else nearest). */
function blockFor(candidates: readonly ModelBlock[], line: number | undefined): ModelBlock | undefined {
    const [first] = candidates;
    if (line === undefined || first === undefined) return first;
    return candidates.reduce((best, b) => (Math.abs(b.line - line) < Math.abs(best.line - line) ? b : best), first);
}

export function assignDigestComments(blocks: readonly ModelBlock[], comments: readonly Comment[]): DigestComments {
    const byCid = new Map<string, ModelBlock[]>();
    for (const b of blocks) byCid.set(b.cid, [...(byCid.get(b.cid) ?? []), b]);
    const byBlock = new Map<number, Comment[]>();
    const others: Comment[] = [];
    for (const c of comments) {
        const t = c.target;
        const block = t.kind === "digest" ? blockFor(byCid.get(t.cid) ?? [], t.line) : undefined;
        if (block === undefined) others.push(c);
        else byBlock.set(block.line, [...(byBlock.get(block.line) ?? []), c]);
    }
    return { byBlock, others };
}
