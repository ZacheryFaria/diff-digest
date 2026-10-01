// The `server run` entry until the CLI exists (plan 4): `bun src/server/main.ts`.
import { homeDir } from "../lib/paths";
import { runServer } from "./run";

runServer(homeDir(), Number(process.env["DIFF_DIGEST_PORT"] ?? 0));
