// Commands for the review: comments, the UI server, and waiting for clicks.
import { commentsCommand, markCommand, noteCommand, resolveCommand } from "../commands/comments";
import { serveCommand } from "../commands/serve";
import { serverRoutes } from "../commands/server";
import { waitCommand } from "../commands/wait";

export const reviewRoutes = {
    comments: commentsCommand,
    resolve: resolveCommand,
    note: noteCommand,
    mark: markCommand,
    serve: serveCommand,
    wait: waitCommand,
    server: serverRoutes,
};
