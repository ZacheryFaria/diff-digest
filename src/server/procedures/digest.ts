import { checkDigest } from "../../lib/check";
import { setGenerated } from "../../lib/config";
import { diffPayload, filePayload } from "../../lib/files";
import { digestPayload } from "../../lib/payload";
import { configPath } from "../../lib/paths";
import { repoKeys } from "../../lib/repo";
import { openById, os } from "../os";

export const digest = {
    get: os.digest.get.handler(({ input, context }) => digestPayload(openById(context, input.id))),
    lint: os.digest.lint.handler(({ input, context }) => checkDigest(openById(context, input.id)).issues),
    check: os.digest.check.handler(({ input, context }) => checkDigest(openById(context, input.id))),
};

export const files = {
    diff: os.files.diff.handler(({ input, context }) => {
        const open = openById(context, input.id);
        return diffPayload(open.ctx, open.files, input.path);
    }),
    read: os.files.read.handler(({ input, context }) => {
        const open = openById(context, input.id);
        return filePayload(open.ctx, open.files, input.path, input.rev);
    }),
    setGenerated: os.files.setGenerated.handler(({ input, context }) => {
        const open = openById(context, input.id);
        setGenerated(input.path, input.on, repoKeys(open.entry.root), configPath(context.home));
        context.bus.publish(input.id, { type: "digest" });
        return { ok: true as const };
    }),
};
