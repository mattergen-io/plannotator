import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract } from "../host-contract";
import type { workspace } from "../workspace";
import { beadSchema, type Bead } from "./model";
import { z } from "zod";
const missingBeadsDirectory = ({
  stdout,
  stderr,
}: {
  stdout: string;
  stderr: string;
}) => /no \.beads directory found/i.test(`${stdout}\n${stderr}`);
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
      if (program === "bd" && missingBeadsDirectory(result))
        throw new Error("No Beads workspace found in this project.");
      throw new Error(
        `${program}: ${result.stderr || result.stdout}`.slice(0, 8192),
      );
    }
    return result.stdout;
  };
  async function json(hostId: string, root: string, args: string[]) {
    return JSON.parse(await exec(hostId, root, "bd", [...args, "--json"]));
  }
  async function ensureContext(source: Awaited<ReturnType<typeof workspace>>) {
    const { hostId, checkoutRoot: root, paths } = source;
    const readContext = (result: {
      code: number;
      stdout: string;
      stderr: string;
    }) => {
      if (result.code !== 0)
        throw new Error(`bd: ${result.stderr || result.stdout}`.slice(0, 8192));
      const context = JSON.parse(result.stdout);
      if (!context.project_id)
        throw new Error(
          "Beads did not return a project identity. Check the workspace configuration.",
        );
      return context;
    };
    let result = await command(hostId, root, "bd", ["context", "--json"]);
    if (result.code === 0 || !missingBeadsDirectory(result))
      return readContext(result);
    const common = await command(hostId, root, "git", [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    const commonDir = common.code === 0 ? common.stdout.trim() : "";
    const primary =
      paths.basename(commonDir) === ".git" ? paths.dirname(commonDir) : root;
    return locked(`setup:${hostId}:${primary}`, async () => {
      result = await command(hostId, root, "bd", ["context", "--json"]);
      if (result.code === 0 || !missingBeadsDirectory(result))
        return readContext(result);
      const directories = [
        ...new Set([paths.join(root, ".beads"), paths.join(primary, ".beads")]),
      ];
      const { existence } = await bb.sdk.hosts.pathsExist({
        hostId,
        paths: directories,
      });
      if (directories.some((directory) => existence[directory] !== false))
        throw new Error(
          "A .beads directory exists, but Beads could not open it. Check the workspace configuration before trying again.",
        );
      await exec(hostId, root, "bd", [
        "init",
        "--init-if-missing",
        "--prefix",
        "bf",
        "--skip-agents",
        "--skip-hooks",
        "--non-interactive",
      ]);
      return readContext(
        await command(hostId, root, "bd", ["context", "--json"]),
      );
    });
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
  return {
    command,
    exec,
    json,
    ensureContext,
    list,
    get,
    write,
    create,
    locked,
  };
}
export type BeadsClient = ReturnType<typeof beadsClient>;
