// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadActionTabProps } from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);

describe("iframe review bridge", () => {
  function mount(composerThread = "thread-1") {
    const slot = renderSlot<ExperimentalThreadActionTabProps>(app.tabs[0]! as { component: React.ComponentType<ExperimentalThreadActionTabProps> },
      { threadId: "thread-1", environment: null, params: null },
      { pluginId: "plannotator", context: { threadId: "thread-1" }, composer: { text: "Existing draft", scope: { kind: "thread", threadId: composerThread } } });
    const frame = slot.getByTitle("Plannotator document review") as HTMLIFrameElement;
    const url = new URL(frame.src);
    const send = (overrides: Record<string, unknown> = {}, origin = url.origin) => window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow, origin, data: { type: "plannotator-request", action: "insert-draft", nonce: url.hash.slice(1), threadId: "thread-1", id: "request", text: "feedback", ...overrides },
    }));
    return { slot, url, send };
  }
  it("uses a different loopback site and accepts only messages from this frame and thread", () => {
    const { slot, url, send } = mount();
    expect(url.origin).not.toBe(location.origin);
    send({}, location.origin); send({ nonce: "wrong" }); send({ threadId: "other" });
    expect(slot.inspection.composer.text).toBe("Existing draft");
    send();
    expect(slot.inspection.composer.text).toContain("feedback");
  });
  it("does not insert into another thread’s composer", () => {
    const { slot, send } = mount("other-thread");
    send();
    expect(slot.inspection.composer.text).toBe("Existing draft");
  });
});
