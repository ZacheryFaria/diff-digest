// The typed client for the contract. The CLI and the UI use it. Pure.
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "./contract";

export type ApiClient = ContractRouterClient<Contract>;

/**
 * `url` is the RPC root, for example `http://127.0.0.1:4777/rpc`. `longPoll` turns off Bun's default request
 * timeout (360 s in Bun 1.4.2), so `wait` can wait for hours. Browsers ignore the option.
 */
export function createApiClient(url: string, options: { readonly longPoll?: boolean } = {}): ApiClient {
    if (options.longPoll !== true) return createORPCClient(new RPCLink({ url }));
    return createORPCClient(
        new RPCLink({ url, fetch: (request, init) => fetch(request, { ...init, timeout: false }) }),
    );
}
