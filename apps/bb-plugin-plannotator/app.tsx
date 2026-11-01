import { definePluginApp, type ExperimentalThreadActionTabProps, type PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { IframeReview } from "./iframe-review";
import { TAB } from "./contracts";

function ReviewTab({ threadId, params }: ExperimentalThreadActionTabProps) {
  const path = params && typeof params === "object" && !Array.isArray(params) && typeof params.path === "string" ? params.path : undefined;
  return <IframeReview key={`${threadId}:${path ?? ""}`} threadId={threadId} path={path} />;
}
function ReviewFile({ path, source, Original }: PluginFileOpenerProps) {
  return source.kind === "workspace" && source.threadId ? <IframeReview key={`${source.threadId}:${path}`} threadId={source.threadId} path={path} /> : <Original />;
}
export default definePluginApp(app => {
  app.slots.experimental_tab({ ...TAB, title: "Plannotator", icon: "ClipboardCheck", layout: "flush", component: ReviewTab });
  app.slots.fileOpener({ id: "markdown-review", title: "Plannotator", extensions: ["md", "markdown"], component: ReviewFile });
});
