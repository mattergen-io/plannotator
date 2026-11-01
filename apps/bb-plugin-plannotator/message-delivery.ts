import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ReviewStore } from "./review-store";
export function messageDelivery(bb: BbPluginApi, store: ReviewStore) {
  const inFlight = new Map<
    string,
    Promise<{ status: "sent" | "uncertain"; error: string | null }>
  >();
  return async function deliver(
    key: string,
    threadId: string,
    text: string,
    resend = false,
    beforeSend?: () => void,
  ) {
    const running = inFlight.get(key);
    if (running) return running;
    const task = (async () => {
      let delivery = store.delivery(key);
      if (delivery?.status === "sent")
        return { status: "sent" as const, error: null };
      if (delivery?.status === "uncertain") {
        const history = await bb.sdk.threads.promptHistory({ threadId });
        if (JSON.stringify(history).includes(delivery.id)) {
          store.putDelivery(key, { ...delivery, status: "sent" });
          return { status: "sent" as const, error: null };
        }
        if (!resend)
          return {
            status: "uncertain" as const,
            error:
              "Delivery could not be confirmed. Check the conversation before choosing Resend.",
          };
      }
      delivery ??= {
        id: randomUUID(),
        threadId,
        text,
        status: "pending",
        error: null,
      };
      store.putDelivery(key, { ...delivery, status: "uncertain" });
      beforeSend?.();
      try {
        await bb.sdk.threads.send({
          threadId,
          mode: "queue-if-active",
          input: [
            {
              type: "text",
              text: `${delivery.text}\n\n[Plannotator review ${delivery.id}]`,
              mentions: [],
            },
          ],
        });
        store.putDelivery(key, { ...delivery, status: "sent", error: null });
        return { status: "sent" as const, error: null };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        store.putDelivery(key, {
          ...delivery,
          status: "uncertain",
          error: message,
        });
        return {
          status: "uncertain" as const,
          error: `Review saved; delivery is uncertain: ${message}`,
        };
      }
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, task);
    return task;
  };
}
