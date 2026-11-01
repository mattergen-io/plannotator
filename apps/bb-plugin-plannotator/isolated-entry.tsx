import React from "react";
import { createRoot } from "react-dom/client";
import { configurePlannotatorUI } from "@plannotator/ui/configure";
import { setMermaidRenderOverride } from "@plannotator/ui/utils/diagram-render";
import { renderMermaidInSandbox } from "./mermaid-sandbox";
import { IsolatedReview } from "./isolated-review";
import styles from "./document-styles.css?raw";
import panel from "./panel.css?raw";

configurePlannotatorUI({
  identityProvider: { getIdentity: () => "You", isCurrentUser: author => author === "You", isEditable: () => false },
  skillCatalogTransport: async () => [], skillContentTransport: async () => null,
  serverSync: () => {}, webmcp: { enabled: false }, richCopy: false, docPreviewFetcher: async () => null,
});
setMermaidRenderOverride(renderMermaidInSandbox);
const css = document.createElement("style"); css.textContent = `${styles}\n${panel}\nhtml,body,#root{height:100%;margin:0}`; document.head.append(css);
const url = new URL(location.href), threadId = url.searchParams.get("thread"), path = url.searchParams.get("path"), nonce = url.hash.slice(1);
if (!threadId || !path || !/^[a-f0-9-]{36}$/i.test(nonce)) document.body.textContent = "Open this preview from Plannotator in BB.";
else createRoot(document.getElementById("root")!).render(<IsolatedReview threadId={threadId} path={path} nonce={nonce} />);
