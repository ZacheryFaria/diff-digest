import { DigestError } from "../../lib/errors";
import { buildModel } from "../../lib/model";
import type { Comment } from "../../lib/schemas";
import { readComments, updateComments } from "../../lib/store";
import { openById, os, type ServerContext } from "../os";

function normalize(text: string): string {
    return text.replaceAll(/\s+/gu, " ").trim().toLowerCase();
}

function change(
    context: ServerContext,
    id: string,
    edit: (comments: readonly Comment[]) => readonly Comment[],
): readonly Comment[] {
    const next = updateComments(openById(context, id).entry.mdPath, edit);
    context.bus.publish(id, { type: "comments" });
    return next;
}

function byId(comments: readonly Comment[], commentId: string): Comment {
    const found = comments.find(c => c.id === commentId);
    if (found === undefined) throw new DigestError("NOT_FOUND", `No comment has the id ${commentId}.`);
    return found;
}

export const comments = {
    list: os.comments.list.handler(({ input, context }) => readComments(openById(context, input.id).entry.mdPath)),
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
        const next = change(context, input.id, list =>
            list.map(c =>
                c.id === input.commentId
                    ? { ...byId(list, input.commentId), status: "resolved" as const, reply: input.reply }
                    : c,
            ),
        );
        return byId(next, input.commentId);
    }),
    note: os.comments.note.handler(({ input, context }) => {
        const block = buildModel(openById(context, input.id).body).blocks.find(b =>
            normalize(b.text).includes(normalize(input.text)),
        );
        if (block === undefined) throw new DigestError("NOT_FOUND", `No digest block contains "${input.text}".`);
        const note: Comment = {
            id: context.newId(),
            created: context.now(),
            author: "agent",
            status: "note",
            target: { kind: "digest", cid: block.cid, section: block.section, text: block.text },
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
