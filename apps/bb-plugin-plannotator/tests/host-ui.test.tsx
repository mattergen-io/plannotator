// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PortalProvider } from "@plannotator/ui/components/PortalProvider";
import { CommentPopover } from "@plannotator/ui/components/CommentPopover";
import { copyTextToClipboard, setClipboardWriter } from "@plannotator/ui/utils/clipboard";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); setClipboardWriter(null); vi.unstubAllGlobals(); });
it("keeps a real comment composer in the host’s portal container", async () => {
  const portal = document.createElement("div"); document.body.appendChild(portal);
  const anchor = document.createElement("button"); document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () => new DOMRect(100, 100, 80, 24);
  const submit = vi.fn();
  const view = render(<PortalProvider container={portal}><CommentPopover anchorEl={anchor} isGlobal contextText="" initialText="Host-scoped comment" onSubmit={submit} onClose={() => {}} allowImages={false} /></PortalProvider>);
  await waitFor(() => expect(portal.querySelector("textarea")).toBeTruthy());
  expect(document.querySelectorAll("textarea")).toHaveLength(1);
  fireEvent.click(view.getByText("Add"));
  expect(submit.mock.calls[0]?.[0]).toBe("Host-scoped comment");
  portal.remove(); anchor.remove();
});
it("routes document copy through the host clipboard capability", async () => {
  const nativeCopy = vi.fn(async () => true); setClipboardWriter(nativeCopy);
  expect(await copyTextToClipboard("Reviewed document")).toBe(true);
  expect(nativeCopy).toHaveBeenCalledWith("Reviewed document");
});

it("reports a failed host clipboard operation without throwing", async () => {
  setClipboardWriter(async () => { throw new Error("Clipboard unavailable"); });
  expect(await copyTextToClipboard("Reviewed document")).toBe(false);
});
