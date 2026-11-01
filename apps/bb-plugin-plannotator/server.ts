import { factory } from "./factory/server";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CHANNEL, rpcContract } from "./contracts";
import { reviewStore } from "./review-store";
import { readDocument } from "./workspace";
import { specSets } from "./spec-sets";
import { reviewMessages } from "./review-messages";

export default function plugin(bb: BbPluginApi) {
  const store = reviewStore(bb), sets = specSets(bb, store), messages = reviewMessages(bb, store, sets);
  const workflow = factory(bb,sets,store);
  bb.rpc.register(rpcContract, {
    async session({ threadId }) { return sets.session(threadId); },
    async specSet({ threadId, folder }) { return sets.select(threadId, folder); },
    async open({ threadId, path, sha256 }) {
      const source = await readDocument(bb, threadId, path);
      store.capture(source);
      await bb.storage.kv.set(`selected:${threadId}`, source.path);
      return store.view(source, sha256);
    },
    async save({ annotations, ...target }) { return store.save(target, annotations); },
    async prepare({ action, set, ...target }) { return messages.prepare(target, action, set); },
    async send({ action, set, resend, ...target }) { return messages.deliver(target, action, resend, set); },
    async reviewed({specFolder,...target}) { await messages.current(target); if(specFolder)await workflow.plan.reviewed(target);else store.reviewed(target);bb.realtime.publish(CHANNEL,{threadId:target.threadId});return { ok: true as const }; },
  });
  for (const event of ["thread.idle", "thread.failed"] as const) bb.events.on(event, ({ thread }) => {
    bb.realtime.publish(CHANNEL, { threadId: thread.id });
  });
}
