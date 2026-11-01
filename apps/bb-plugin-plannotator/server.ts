import { factory } from "./factory/server";
import isolatedApp from "./isolated-app.generated.txt" with { type: "text" };
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CHANNEL, rpcContract } from "./contracts";
import { reviewStore } from "./review-store";
import { readDocument } from "./workspace";
import { specSets } from "./spec-sets";
import { reviewMessages } from "./review-messages";

export default function plugin(bb: BbPluginApi) {
  bb.http.route("GET", "/isolated", c => c.html('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plannotator isolated preview</title></head><body><div id="root"></div><script type="module" src="/api/v1/plugins/plannotator/http/isolated-app.js?v=2"></script></body></html>'));
  bb.http.route("GET", "/isolated-app.js", c => c.body(isolatedApp, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }));
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
