import { bodyLineOffset } from "../../lib/digest";
import { DigestError } from "../../lib/errors";
import { buildModel, type ModelBlock } from "../../lib/model";
import type { OpenDigest } from "../../lib/payload";
import type { Comment } from "../../lib/schemas";
import { readComments, updateComments } from "../../lib/store";
import { entryById, openById, os, type ServerContext } from "../os";

function normalize(text: string): string {
    return text.replaceAll(/\s+/gu, " ").trim().toLowerCase();
}

function change(
    context: ServerContext,
    id: string,
    edit: (comments: readonly Comment[]) => readonly Comment[],
): readonly Comment[] {
    const next = updateComments(entryById(context, id).mdPath, edit);
    context.bus.publish(id, { type: "comments" });
    return next;
}

function byId(comments: readonly Comment[], commentId: string): Comment {
    const found = comments.find(c => c.id === commentId);
    if (found === undefined) throw new DigestError("NOT_FOUND", `No comment has the id ${commentId}.`);
    return found;
}

/** The model blocks with file lines: the body starts after the frontmatter. */
function fileBlocks(open: OpenDigest): readonly ModelBlock[] {
    return buildModel(open.body, bodyLineOffset(open.md, open.body)).blocks;
}

/** The block whose text equals `text`, else the one block that contains it. */
function findBlock(blocks: readonly ModelBlock[], text: string): ModelBlock {
    const wanted = normalize(text);
    const equal = blocks.find(b => normalize(b.text) === wanted);
    if (equal !== undefined) return equal;
    const matches = blocks.filter(b => normalize(b.text).includes(wanted));
    const [first, ...others] = matches;
    if (first === undefined) throw new DigestError("NOT_FOUND", `No digest block contains "${text}".`);
    if (others.length > 0) {
        throw new DigestError("BAD_INPUT", `${matches.length} blocks contain "${text}".`, {
            hint: "Give more of the block text, so that only one block matches.",
        });
    }
    return first;
}

export const comments = {
    list: os.comments.list.handler(({ input, context }) => readComments(entryById(context, input.id).mdPath)),
    add: os.comments.add.handler(({ input, context }) => {
        const comment: Comment = {
            id: context.newId(),
            created: context.now(),
            author: "user",
            status: "open",
            target: input.target,
            body: input.body,
        };
        change(context, input.id, list => [...list, comment]);
        return comment;
    }),
    remove: os.comments.remove.handler(({ input, context }) => {
        change(context, input.id, list => {
            byId(list, input.commentId);
            return list.filter(c => c.id !== input.commentId);
        });
        return { ok: true as const };
    }),
    resolve: os.comments.resolve.handler(({ input, context }) => {
        const next = change(context, input.id, list => {
            const found = byId(list, input.commentId);
            const resolved: Comment = { ...found, status: "resolved", reply: input.reply };
            return list.map(c => (c.id === input.commentId ? resolved : c));
        });
        return byId(next, input.commentId);
    }),
    note: os.comments.note.handler(({ input, context }) => {
        const block = findBlock(fileBlocks(openById(context, input.id)), input.text);
        const note: Comment = {
            id: context.newId(),
            created: context.now(),
            author: "agent",
            status: "note",
            target: { kind: "digest", cid: block.cid, section: block.section, text: block.text, line: block.line },
            body: input.body,
        };
        change(context, input.id, list => [...list, note]);
        return note;
    }),
    markShared: os.comments.markShared.handler(({ input, context }) => {
        const wanted = new Set(input.commentIds);
        return change(context, input.id, list => {
            for (const commentId of input.commentIds) byId(list, commentId);
            return list.map(c => (wanted.has(c.id) ? { ...c, status: "shared" as const, ref: input.ref } : c));
        });
    }),
};
