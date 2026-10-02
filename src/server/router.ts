// The server's implementation of the contract. The typecheck fails if a procedure is missing.
import { actions, events } from "./procedures/actions";
import { comments } from "./procedures/comments";
import { digest, files } from "./procedures/digest";
import { publish } from "./procedures/publish";
import { os } from "./os";

export const router = os.router({ digest, files, comments, actions, events, publish });
export type Router = typeof router;
