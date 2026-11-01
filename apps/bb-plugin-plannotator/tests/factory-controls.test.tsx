// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { FactoryControls } from "../factory/controls";
import { ReviewPlatformContext, type ReviewPlatform } from "../review-platform";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import {
  factoryContract,
  factoryViewSchema,
  type FactoryView,
} from "../factory/contracts";
import { CHANNEL } from "../contracts";
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<object>()),
  experimental_ProviderModelPicker: () => <span>Native model picker</span>,
}));
afterEach(cleanup);
const contract = {
  factoryStatus: factoryContract.factoryStatus,
  factoryInitialize: factoryContract.factoryInitialize,
  factoryAccept: factoryContract.factoryAccept,
  factoryDraft: factoryContract.factoryDraft,
};
function FactoryHost(props: React.ComponentProps<typeof FactoryControls>) {
  const rpc = useRpc<typeof factoryContract>();
  const listeners = React.useRef(new Set<() => void>());
  useRealtime(CHANNEL, () => listeners.current.forEach(listener => listener()));
  const platform = React.useMemo(() => ({ factoryRpc: rpc, reviewRpc: rpc, insertDraft: async () => {}, openThread: () => {}, openFile: () => {}, ModelPicker: () => <span>Native model picker</span>, subscribe: (listener: () => void) => { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; } }) as unknown as ReviewPlatform, [rpc]);
  return <ReviewPlatformContext.Provider value={platform}><FactoryControls {...props} /></ReviewPlatformContext.Provider>;
}
const path = ".kiro/specs/demo/requirements.md",
  sha = "a".repeat(64);
function initial(importing = false): FactoryView {
  return factoryViewSchema.parse({
    configured: true,
    error: null,
    spec: importing ? null : { id: "bf-spec", title: "Demo", status: "open" },
    state: importing
      ? null
      : {
          kind: "spec",
          checkoutRoot: "/repo",
          folder: ".kiro/specs/demo",
          threadId: "planner",
          phase: "requirements",
          revision: 2,
          mode: "draft",
          members: { [path]: "requirements" },
          reviewed: {},
          acceptances: [],
          taskIds: [],
          sizing: null,
          authorizationId: null,
          pendingPrompt: null,
          parentId: null,
          error: null,
        },
    suggestedPhase: importing ? "design" : "requirements",
    files: [
      {
        path,
        sha256: sha,
        phase: "requirements",
        reviewed: false,
        added: false,
      },
    ],
    treeStatuses: { [path]: "unreviewed" },
    tasks: [],
    runs: [],
  });
}
function mount(importing = false, beadsError = false) {
  let view = beadsError
    ? {
        ...initial(true),
        configured: false,
        error: "Beads database is unavailable.",
      }
    : initial(importing);
  const flush = vi.fn(async () => {}),
    initialize = vi.fn(async () => {
      view = initial();
      return view;
    }),
    accept = vi.fn(async () => view);
  const draft = vi.fn(async () => {
    view = {
      ...view,
      state: {
        ...view.state!,
        revision: 3,
        sizing: {
          manifest: "manifest",
          previousReplyHash: "old",
          assessment: "Small leaf; continue to Design.",
        },
      },
    };
    return { ok: true as const };
  });
  const slot = renderSlot(
    { component: FactoryHost },
    {
      threadId: "planner",
      folder: ".kiro/specs/demo",
      environmentId: "env-1",
      flush,
      onInitialized: vi.fn(),
      onView: vi.fn(),
      onRefresh: vi.fn(),
    },
    {
      experimental_rpcContract: contract,
      pluginId: "plannotator",
      context: { threadId: "planner" },
      rpc: {
        factoryStatus: () => view,
        factoryInitialize: initialize,
        factoryAccept: accept,
        factoryDraft: draft,
      },
    },
  );
  return {
    slot,
    flush,
    initialize,
    accept,
    draft,
    restore: () => {
      view = initial(true);
    },
    review: () => {
      view = {
        ...view,
        files: view.files.map((f) => ({ ...f, reviewed: true })),
      };
    },
  };
}
it("requires explicit confirmation to import earlier accepted phases", async () => {
  const { slot, initialize } = mount(true);
  await waitFor(() => expect(slot.getByText("Spec workflow")).toBeTruthy());
  fireEvent.click(slot.getByText("Spec workflow"));
  await waitFor(() =>
    expect(
      (slot.getByLabelText("Current phase") as HTMLSelectElement).value,
    ).toBe("design"),
  );
  expect(
    (slot.getByText("Initialize phase tracking") as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(initialize).not.toHaveBeenCalled();
  fireEvent.click(
    slot.getByLabelText(
      "I accept the current documents in the earlier phases.",
    ),
  );
  fireEvent.click(slot.getByText("Initialize phase tracking"));
  await waitFor(() =>
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "design", confirmPrior: true }),
    ),
  );
  slot.unmount();
});
it("requires current reviews and a sizing assessment before accepting Requirements", async () => {
  const { slot, review, accept, draft, flush } = mount();
  await waitFor(() => expect(slot.getByText("Accept → Design")).toBeTruthy());
  expect(
    (slot.getByText("Accept → Design") as HTMLButtonElement).disabled,
  ).toBe(true);
  review();
  await slot.behavior.emitRealtime(CHANNEL, { threadId: "planner" });
  expect(
    (slot.getByText("Accept → Design") as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(slot.getByText("Assess size"));
  await waitFor(() =>
    expect(draft).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sizing" }),
    ),
  );
  await waitFor(() =>
    expect(
      (slot.getByText("Accept → Design") as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(slot.getByText("Accept → Design"));
  await waitFor(() =>
    expect(accept).toHaveBeenCalledWith({
      threadId: "planner",
      folder: ".kiro/specs/demo",
      revision: 3,
      manifest: [{ path, sha256: sha }],
      decision: "continue",
    }),
  );
  expect(flush).toHaveBeenCalled();
  slot.unmount();
});

it("shows Beads errors and lets the user retry", async () => {
  const { slot, restore } = mount(false, true);
  await waitFor(() => expect(slot.getByText("Spec workflow")).toBeTruthy());
  fireEvent.click(slot.getByText("Spec workflow"));
  await waitFor(() =>
    expect(slot.getByText("Beads database is unavailable.")).toBeTruthy(),
  );
  expect(slot.queryByText("Initialize project Beads")).toBeNull();
  restore();
  fireEvent.click(slot.getByText("Retry"));
  await waitFor(() =>
    expect(slot.getByLabelText("Current phase")).toBeTruthy(),
  );
  slot.unmount();
});
