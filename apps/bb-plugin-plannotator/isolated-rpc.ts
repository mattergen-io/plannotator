import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contracts";

/** BB's documented plugin RPC endpoint, used by the isolated Browser page. */
export const isolatedRpc = {
  async call(method: string, input: unknown) {
    const response = await fetch(`/api/v1/plugins/plannotator/rpc/${encodeURIComponent(method)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input ?? null),
    });
    const body = await response.json();
    if (!response.ok || body?.ok !== true)
      throw new Error(typeof body?.error === "string" ? body.error : body?.error?.message ?? `Review request failed (${response.status}).`);
    return body.result;
  },
} as PluginRpcClient<typeof rpcContract>;
