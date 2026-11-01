// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { processDocument } from "../document-processing";
import { useDocumentProcessing } from "../use-document-processing";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); FakeWorker.instances = []; });

it("preserves document blocks and computes review changes only when a baseline exists", () => {
  const first = processDocument("# Title\n\nCurrent text", null);
  expect(first.blocks.length).toBeGreaterThan(0);
  expect(first.diff).toBeNull();
  const revised = processDocument("# Title\n\nCurrent text", "# Title\n\nPrevious text");
  expect(revised.blocks).toEqual(first.blocks);
  expect(revised.diff?.stats.modifications).toBeGreaterThan(0);
  expect(revised.removals.map(item => item.content).join(" ")).toContain("Previous");
});

it("cancels obsolete processing and ignores a late result after switching documents", () => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
  const { result, rerender, unmount } = renderHook(({ content }) => useDocumentProcessing(content, null), { initialProps: { content: "Old" } });
  const old = FakeWorker.instances[0]!;
  expect(old.postMessage).toHaveBeenCalledWith({ content: "Old", baseline: null });
  rerender({ content: "New" });
  const latest = FakeWorker.instances[1]!;
  expect(old.terminate).toHaveBeenCalled();
  act(() => old.onmessage?.({ data: { ok: true, result: processDocument("Old", null) } } as MessageEvent));
  expect(result.current).toBeNull();
  act(() => latest.onmessage?.({ data: { ok: true, result: processDocument("New", null) } } as MessageEvent));
  expect(result.current?.value?.blocks).toEqual(processDocument("New", null).blocks);
  unmount();
  expect(latest.terminate).toHaveBeenCalled();
});

it("surfaces processing errors without retrying the calculation on the UI thread", () => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
  const { result } = renderHook(() => useDocumentProcessing("text", null));
  act(() => FakeWorker.instances[0]!.onmessage?.({ data: { ok: false, error: "Cannot parse" } } as MessageEvent));
  expect(result.current).toMatchObject({ value: null, error: "Cannot parse", fallback: false });
});
