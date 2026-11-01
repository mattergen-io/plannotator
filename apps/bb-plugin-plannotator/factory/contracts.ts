import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { folderPath } from "../contracts";
import {
  beadSchema,
  phaseSchema,
  roleSchema,
  specStateSchema,
  taskStateSchema,
  runStateSchema,
} from "./model";
const selection = z.object({ threadId: z.string().min(1), folder: folderPath });
export const factoryViewSchema = z.object({
  configured: z.boolean(),
  error: z.string().nullable(),
  spec: beadSchema.nullable(),
  state: specStateSchema.nullable(),
  suggestedPhase: phaseSchema,
  files: z.array(
    z.object({
      path: z.string(),
      sha256: z.string(),
      phase: z.enum(["requirements", "design", "tasks", "reference"]),
      reviewed: z.boolean(),
      added: z.boolean(),
    }),
  ),
  treeStatuses: z
    .record(
      z.string(),
      z.enum(["unreviewed", "changed", "reviewed", "reference"]),
    )
    .default({}),
  tasks: z.array(
    z.object({ bead: beadSchema, state: taskStateSchema, pack: z.string() }),
  ),
  runs: z.array(z.object({ bead: beadSchema, state: runStateSchema })),
});
export type FactoryView = z.infer<typeof factoryViewSchema>;
export const factoryContract = defineRpcContract({
  factoryStatus: { input: selection.strict(), output: factoryViewSchema },
  factorySetup: {
    input: selection.strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  factoryInitialize: {
    input: selection
      .extend({
        phase: phaseSchema,
        confirmPrior: z.boolean(),
        manifest: z.array(z.object({ path: z.string(), sha256: z.string() })),
        members: z.record(
          z.string(),
          z.enum(["requirements", "design", "tasks", "reference"]),
        ),
      })
      .strict(),
    output: factoryViewSchema,
  },
  factoryMember: {
    input: selection
      .extend({
        revision: z.number().int(),
        path: folderPath,
        phase: z.enum(["requirements", "design", "tasks", "reference"]),
      })
      .strict(),
    output: factoryViewSchema,
  },
  factoryAccept: {
    input: selection
      .extend({
        revision: z.number().int(),
        manifest: z.array(z.object({ path: z.string(), sha256: z.string() })),
        decision: z.enum(["continue", "split"]).optional(),
      })
      .strict(),
    output: factoryViewSchema,
  },
  factoryNewSpec: {
    input: z
      .object({
        threadId: z.string().min(1),
        name: z.string().min(1).max(160),
        idea: z.string().min(1).max(16000),
      })
      .strict(),
    output: z.object({ folder: z.string() }),
  },
  factoryDeliver: {
    input: selection.extend({ resend: z.boolean().default(false) }).strict(),
    output: factoryViewSchema,
  },
  factoryReturn: {
    input: selection
      .extend({ revision: z.number().int(), phase: phaseSchema })
      .strict(),
    output: factoryViewSchema,
  },
  factoryRetry: {
    input: selection.extend({ runId: z.string(), beadId: z.string() }).strict(),
    output: factoryViewSchema,
  },
  factoryStop: {
    input: selection.extend({ runId: z.string() }).strict(),
    output: factoryViewSchema,
  },
  factoryPreview: {
    input: selection.strict(),
    output: z.array(
      z.object({
        key: z.string(),
        title: z.string(),
        pack: z.string(),
        sources: z.array(z.object({ path: z.string(), sha256: z.string() })),
      }),
    ),
  },
  factoryDraft: {
    input: selection
      .extend({
        action: z.enum([
          "requirements",
          "sizing",
          "children",
          "tasks",
          "design",
        ]),
        idea: z.string().max(16000).default(""),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  factoryStart: {
    input: selection
      .extend({
        worker: roleSchema,
        reviewer: roleSchema,
        command: z.string().min(1).max(4096),
        setupCommand: z.string().max(4096).default(""),
      })
      .strict(),
    output: factoryViewSchema,
  },
  factoryPause: {
    input: selection.extend({ runId: z.string() }).strict(),
    output: factoryViewSchema,
  },
  factoryResume: {
    input: selection.extend({ runId: z.string() }).strict(),
    output: factoryViewSchema,
  },
});
