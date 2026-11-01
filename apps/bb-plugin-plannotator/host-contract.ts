import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const hostContract = defineRpcContract({
  command: {
    input: z
      .object({
        root: z.string().min(1),
        program: z.enum(["bd", "git", "check"]),
        args: z.array(z.string()).max(100).default([]),
        command: z.string().max(4096).optional(),
        timeout: z.number().min(1000).max(600000).default(60000),
      })
      .strict(),
    output: z.object({
      stdout: z.string(),
      stderr: z.string(),
      code: z.number(),
    }),
  },
});
