import { definePluginApp, type ExperimentalThreadActionTabProps } from "@get-bb/plugin-sdk/app";
import { IframeReview } from "./iframe-review";
import { TAB } from "./contracts";

function ReviewTab({ threadId, params }: ExperimentalThreadActionTabProps) {
  const path = params && typeof params === "object" && !Array.isArray(params) && typeof params.path === "string" ? params.path : undefined;
  return <IframeReview key={`${threadId}:${path ?? ""}`} threadId={threadId} path={path} />;
}
export default definePluginApp(app => {
  app.slots.experimental_tab({ ...TAB, title: "Plannotator", icon: "ClipboardCheck", layout: "flush", component: ReviewTab });
});
