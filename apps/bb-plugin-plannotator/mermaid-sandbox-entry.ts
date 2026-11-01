import "@plannotator/ui/utils/mermaid-eager";
import { getMermaidRuntime } from "@plannotator/ui/utils/mermaid";

const mermaid = getMermaidRuntime()!;
let queue = Promise.resolve();
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.type !== "render-mermaid") return;
  const { id, renderId, source, config, fontFamily } = event.data;
  queue = queue.then(async () => {
    try {
      document.body.style.fontFamily = fontFamily;
      mermaid.initialize(config);
      const { svg } = await mermaid.render(renderId, source);
      window.parent.postMessage({ type: "mermaid-result", id, svg }, "*");
    } catch (error) {
      window.parent.postMessage({ type: "mermaid-result", id, error: error instanceof Error ? error.message : String(error) }, "*");
    }
  });
});
window.parent.postMessage({ type: "mermaid-ready" }, "*");
