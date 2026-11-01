import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./host-contract";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async command(input, context) {
      if (!path.isAbsolute(input.root))
        throw new Error("A factory command requires an absolute workspace.");
      const cwd = await realpath(input.root);
      const env = { ...process.env };
      for (const key of Object.keys(env))
        if (
          key.startsWith("GIT_") ||
          key.startsWith("BEADS_") ||
          key.startsWith("BD_")
        )
          delete env[key];
      const gitAllowed = new Set([
        "rev-parse",
        "status",
        "worktree",
        "branch",
        "show-ref",
        "diff",
        "log",
        "add",
        "commit",
        "merge",
        "ls-files",
        "check-ref-format",
      ]);
      const beadsAllowed = new Set([
        "version",
        "context",
        "init",
        "list",
        "show",
        "create",
        "update",
        "close",
        "reopen",
        "ready",
        "dep",
        "comments",
        "heartbeat",
        "gate",
      ]);
      if (input.program === "git" && !gitAllowed.has(input.args[0]))
        throw new Error("Unsupported factory Git operation.");
      if (input.program === "bd" && !beadsAllowed.has(input.args[0]))
        throw new Error("Unsupported factory Beads operation.");
      if (input.program === "check" && !input.command?.trim())
        throw new Error("Choose a verification command before starting.");
      const executable =
        input.program === "check"
          ? process.platform === "win32"
            ? "cmd.exe"
            : "/bin/sh"
          : input.program;
      const args =
        input.program === "check"
          ? process.platform === "win32"
            ? ["/c", input.command!]
            : ["-c", input.command!]
          : input.program === "bd"
            ? ["--sandbox", "--actor", "bb-factory", ...input.args]
            : input.args;
      // File inputs avoid the OS argument-size ceiling for accepted source snapshots.
      const scratch =
        input.program === "bd"
          ? await mkdtemp(path.join(tmpdir(), "bb-factory-command-"))
          : null;
      if (scratch)
        for (let index = 0; index < args.length - 1; index++) {
          if (args[index] !== "--metadata" && args[index] !== "--description")
            continue;
          const file = path.join(scratch, `input-${index}`);
          await writeFile(file, args[index + 1], { mode: 0o600 });
          if (args[index] === "--metadata") args[index + 1] = `@${file}`;
          else {
            args[index] = "--body-file";
            args[index + 1] = file;
          }
        }
      try {
        return await new Promise<{
          code: number;
          stdout: string;
          stderr: string;
        }>((resolve, reject) => {
          execFile(
            executable,
            args,
            {
              cwd,
              env,
              signal: context.signal,
              timeout: input.timeout,
              maxBuffer: 4 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
              if (context.signal.aborted)
                return reject(new Error("Factory command cancelled."));
              if (error && typeof error.code !== "number")
                return reject(
                  new Error(`Could not run ${input.program}: ${error.message}`),
                );
              resolve({
                code: error ? Number(error.code) : 0,
                stdout: String(stdout),
                stderr: String(stderr),
              });
            },
          );
        });
      } finally {
        if (scratch) await rm(scratch, { recursive: true, force: true });
      }
    },
  },
});
