import { expect, it, vi } from "vitest";
import { factoryFixture } from "./factory-fixture";

it("stops polling a remembered location with no active runs", async () => {
  const f = await factoryFixture();
  const list = vi.spyOn(f.beads, "list").mockResolvedValue([]);
  await f.engine.remember({ hostId: "host-1", root: f.root });
  await f.engine.tick();
  expect(list).toHaveBeenCalledTimes(2);
  await f.engine.tick();
  expect(list).toHaveBeenCalledTimes(2);
  await f.engine.remember({ hostId: "host-1", root: f.root });
  await f.engine.tick();
  expect(list).toHaveBeenCalledTimes(4);
});

it("does not discard a location reactivated while an idle check is in flight", async () => {
  const f = await factoryFixture();
  let complete!: (value: never[]) => void;
  const list = vi.spyOn(f.beads, "list").mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue([]);
  const location = { hostId: "host-1", root: f.root };
  await f.engine.remember(location);
  const tick = f.engine.tick();
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  await f.engine.remember(location);
  complete([]);
  await tick;
  await f.engine.tick();
  expect(list).toHaveBeenCalledTimes(3);
});

it("retains a location if its Beads check fails", async () => {
  const f = await factoryFixture();
  const list = vi.spyOn(f.beads, "list").mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue([]);
  await f.engine.remember({ hostId: "host-1", root: f.root });
  await f.engine.tick();
  await f.engine.tick();
  expect(list).toHaveBeenCalledTimes(3);
});
