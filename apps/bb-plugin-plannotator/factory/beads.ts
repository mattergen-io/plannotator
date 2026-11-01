import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract } from "../host-contract";
import { beadSchema, type Bead } from "./model";
import { z } from "zod";
export function beadsClient(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const locks = new Map<string, Promise<unknown>>();
  async function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = locks.get(key) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    locks.set(key, next);
    try {
      return await next;
    } finally {
      if (locks.get(key) === next) locks.delete(key);
    }
  }
  async function command(
    hostId: string,
    root: string,
    program: "bd" | "git" | "check",
    args: string[],
    check?: string,
    timeout = 60000,
  ) {
    const result = await host.call(
      "command",
      { root, program, args, ...(check ? { command: check } : {}), timeout },
      { hostId, timeoutMs: timeout + 15000 },
    );
    return result;
  }
  const exec = async (
    hostId: string,
    root: string,
    program: "bd" | "git",
    args: string[],
  ) => {
    const result = await command(hostId, root, program, args);
    if (result.code !== 0) {
      if (
        program === "bd" &&
        /no \.beads directory found/i.test(`${result.stdout}\n${result.stderr}`)
      )
        throw new Error(
          "This project doesn't have a Beads workspace yet. Select Initialize project Beads to set one up.",
        );
      throw new Error(
        `${program}: ${result.stderr || result.stdout}`.slice(0, 8192),
      );
    }
    return result.stdout;
  };
  async function json(hostId: string, root: string, args: string[]) {
    return JSON.parse(await exec(hostId, root, "bd", [...args, "--json"]));
  }
  async function list(hostId: string, root: string) {
    return z
      .array(beadSchema)
      .parse(
        await json(hostId, root, [
          "list",
          "--all",
          "--include-gates",
          "--limit",
          "1000",
          "--label",
          "bb-factory",
        ]),
      );
  }
  async function get(hostId: string, root: string, id: string): Promise<Bead> {
    const value = await json(hostId, root, ["show", id]);
    return beadSchema.parse(Array.isArray(value) ? value[0] : value);
  }
  async function write(
    hostId: string,
    root: string,
    id: string,
    state: unknown,
    status?: string,
  ) {
    const current = await get(hostId, root, id);
    await json(hostId, root, [
      "update",
      id,
      "--metadata",
      JSON.stringify({ ...current.metadata, bbFactory: state }),
      ...(status ? ["--status", status] : []),
    ]);
    return get(hostId, root, id);
  }
  async function create(
    hostId: string,
    root: string,
    id: string,
    title: string,
    type: string,
    state: unknown,
    parent?: string,
    description?: string,
    status = "open",
  ) {
    const existing = (await list(hostId, root)).find((b) => b.id === id);
    const bead =
      existing ??
      beadSchema.parse(
        await json(hostId, root, [
          "create",
          "--id",
          id,
          "--force",
          "--title",
          title,
          "--type",
          type,
          "--status",
          status,
          "--labels",
          "bb-factory",
          "--metadata",
          JSON.stringify({ bbFactory: state }),
          ...(description ? ["--description", description] : []),
        ]),
      );
    if (parent) {
      await json(hostId, root, ["update", id, "--parent", parent]);
      return get(hostId, root, id);
    }
    return bead;
  }
  return { command, exec, json, list, get, write, create, locked };
}
export type BeadsClient = ReturnType<typeof beadsClient>;
