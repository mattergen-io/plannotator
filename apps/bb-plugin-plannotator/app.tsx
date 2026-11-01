import { definePluginApp, experimental_copyToClipboard, type ExperimentalThreadActionTabProps, type PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { configurePlannotatorUI } from "@plannotator/ui/configure";
import { setClipboardWriter } from "@plannotator/ui/utils/clipboard";
import { setMermaidRenderOverride } from "@plannotator/ui/utils/diagram-render";
import { renderMermaidInSandbox } from "./mermaid-sandbox";
import { DocumentPanel } from "./document-panel";
import { TAB } from "./contracts";
import "./document-styles.css";
import "./panel.css";

configurePlannotatorUI({
  storageBackend: {
    getItem: key => { try { return localStorage.getItem(`bb.plannotator.${key}`); } catch { return null; } },
    setItem: (key, value) => { try { localStorage.setItem(`bb.plannotator.${key}`, value); } catch {} },
    removeItem: key => { try { localStorage.removeItem(`bb.plannotator.${key}`); } catch {} },
  },
  identityProvider: { getIdentity: () => "You", isCurrentUser: author => author === "You", isEditable: () => false },
  skillCatalogTransport: async () => [], skillContentTransport: async () => null,
  serverSync: () => {}, webmcp: { enabled: false }, richCopy: false,
  docPreviewFetcher: async () => null,
});
setClipboardWriter(text => experimental_copyToClipboard({ text }));
setMermaidRenderOverride(renderMermaidInSandbox);

function ReviewTab({ threadId, params }: ExperimentalThreadActionTabProps) {
  const path = params && typeof params === "object" && !Array.isArray(params) && typeof params.path === "string" ? params.path : undefined;
  return <DocumentPanel key={`${threadId}:${path ?? ""}`} threadId={threadId} initialPath={path} />;
}
function ReviewFile({ path, source, Original }: PluginFileOpenerProps) {
  return source.kind === "workspace" && source.threadId ? <DocumentPanel key={`${source.threadId}:${path}`} threadId={source.threadId} initialPath={path} /> : <Original />;
}
export default definePluginApp(app => {
  app.slots.experimental_tab({ ...TAB, title: "Plannotator", icon: "ClipboardCheck", layout: "flush", component: ReviewTab });
  app.slots.fileOpener({ id: "markdown-review", title: "Plannotator", extensions: ["md", "markdown"], component: ReviewFile });
});
