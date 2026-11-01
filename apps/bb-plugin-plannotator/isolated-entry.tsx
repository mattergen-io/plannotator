import React from "react";
import { createRoot } from "react-dom/client";
import { configurePlannotatorUI } from "@plannotator/ui/configure";
import { setMermaidRenderOverride } from "@plannotator/ui/utils/diagram-render";
import { renderMermaidInSandbox } from "./mermaid-sandbox";
import { DocumentPanel } from "./document-panel";
import { IframePlatform } from "./iframe-platform";
import styles from "./document-styles.css?raw";
import panel from "./panel.css?raw";

configurePlannotatorUI({
  identityProvider: { getIdentity: () => "You", isCurrentUser: author => author === "You", isEditable: () => false },
  skillCatalogTransport: async () => [], skillContentTransport: async () => null,
  serverSync: () => {}, webmcp: { enabled: false }, richCopy: false, docPreviewFetcher: async () => null,
});
setMermaidRenderOverride(renderMermaidInSandbox);
const css = document.createElement("style"); css.textContent = `${styles}\n${panel}\nhtml,body,#root{height:100%;margin:0}`; document.head.append(css);
const url = new URL(location.href), threadId = url.searchParams.get("thread"), path = url.searchParams.get("path"), nonce = url.hash.slice(1), parentOrigin = url.searchParams.get("parentOrigin") ?? location.origin;
window.addEventListener("message", event => {
  if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== "plannotator-theme" || event.data.nonce !== nonce) return;
  document.documentElement.classList.toggle("dark", event.data.dark === true);
  if (event.data.tokens && typeof event.data.tokens === "object") {
    for (const [name, value] of Object.entries(event.data.tokens)) {
      if (/^--[a-z-]+$/.test(name) && typeof value === "string" && value.length < 256) document.documentElement.style.setProperty(name, value);
    }
  }
});
if (!threadId || !/^[a-f0-9-]{36}$/i.test(nonce)) document.body.textContent = "Open this preview from Plannotator in BB.";
else createRoot(document.getElementById("root")!).render(<IframePlatform threadId={threadId} nonce={nonce} parentOrigin={parentOrigin}><DocumentPanel threadId={threadId} initialPath={path ?? undefined} /></IframePlatform>);
