import { createContext, useContext, useEffect, type ComponentType } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contracts";
import type { factoryContract } from "./factory/contracts";
import type { Role } from "./factory/model";

export interface ReviewPlatform {
  reviewRpc: PluginRpcClient<typeof rpcContract>;
  factoryRpc: PluginRpcClient<typeof factoryContract>;
  insertDraft(text: string): Promise<void>;
  openThread(threadId: string, split?: boolean): void;
  openFile(environmentId: string, path: string): void;
  ModelPicker: ComponentType<{ value: Role; onChange: (value: Role) => void; disabled?: boolean; environmentId?: string }>;
  subscribe(listener: () => void): () => void;
}
export const ReviewPlatformContext = createContext<ReviewPlatform | null>(null);
export function useReviewPlatform() {
  const platform = useContext(ReviewPlatformContext);
  if (!platform) throw new Error("Review platform is unavailable.");
  return platform;
}
export function useReviewRefresh(listener: () => void) {
  const { subscribe } = useReviewPlatform();
  useEffect(() => subscribe(listener), [subscribe, listener]);
}
