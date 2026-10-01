// The typed client for the contract. The CLI and the UI use it. Pure.
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "./contract";

export type ApiClient = ContractRouterClient<Contract>;

/** `url` is the RPC root, for example `http://127.0.0.1:4777/rpc`. */
export function createApiClient(url: string): ApiClient {
    return createORPCClient(new RPCLink({ url }));
}
