import { readConfigFile, resolveConfig } from "../../lib/config";
import { configPath } from "../../lib/paths";
import { publishDigest } from "../../lib/publish/digest";
import { publishReview } from "../../lib/publish/review";
import { repoKeys } from "../../lib/repo";
import { entryById, openById, os } from "../os";

export const publish = {
    digest: os.publish.digest.handler(({ input, context }) =>
        publishDigest(
            openById(context, input.id),
            { to: input.to, force: input.force, dryRun: input.dryRun, home: context.home },
            context.deps,
        ),
    ),
    review: os.publish.review.handler(async ({ input, context }) => {
        const report = await publishReview(openById(context, input.id), input.to, context.home, context.deps);
        context.bus.publish(input.id, { type: "comments" });
        return report;
    }),
    backends: os.publish.backends.handler(({ input, context }) => {
        const config = resolveConfig(
            readConfigFile(configPath(context.home)),
            repoKeys(entryById(context, input.id).root),
        );
        return Object.entries(config.backends).map(([name, b]) => ({ name, type: b.type }));
    }),
};
