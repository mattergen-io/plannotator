import { z } from "zod";
export const phases = ["requirements", "design", "tasks"] as const;
export const phaseSchema = z.enum(phases);
export type Phase = z.infer<typeof phaseSchema>;
export const snapshotSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  content: z.string(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const acceptanceSchema = z.object({
  phase: phaseSchema,
  at: z.string(),
  documents: z.array(snapshotSchema),
  inventory: z.array(z.object({ path: z.string(), sha256: z.string() })),
  decision: z.enum(["continue", "split"]).optional(),
  assessment: z.string().optional(),
});
export const specStateSchema = z.object({
  kind: z.literal("spec"),
  checkoutRoot: z.string(),
  folder: z.string(),
  threadId: z.string(),
  phase: phaseSchema,
  revision: z.number().int(),
  mode: z.enum(["draft", "decomposed", "publishing", "ready"]),
  members: z.record(z.string(), z.enum([...phases, "reference"])),
  reviewed: z.record(z.string(), z.string()),
  acceptances: z.array(acceptanceSchema),
  taskIds: z.array(z.string()),
  sizing: z
    .object({
      manifest: z.string(),
      previousReplyHash: z.string(),
      assessment: z.string().nullable(),
    })
    .nullable()
    .default(null),
  authorizationId: z.string().nullable(),
  pendingPrompt: z.object({ key: z.string(), text: z.string() }).nullable(),
  parentId: z.string().nullable(),
  error: z.string().nullable(),
});
export type SpecState = z.infer<typeof specStateSchema>;
export const roleSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    reasoningLevel: z.string().min(1),
    serviceTier: z.string().optional(),
  })
  .strict();
export type Role = z.infer<typeof roleSchema>;
export const defaultRoles = {
  worker: {
    providerId: "codex",
    model: "gpt-6.1-terra",
    reasoningLevel: "medium",
  },
  reviewer: {
    providerId: "codex",
    model: "gpt-6.1-sol",
    reasoningLevel: "xhigh",
  },
};
export const taskDefinitionSchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  title: z.string().min(1),
  responsibilities: z.string().min(1),
  requirements: z.array(z.string()).min(1),
  design: z.array(z.string()).min(1),
  dependencies: z.array(z.string()),
  acceptance: z.string().min(1),
  verification: z.string().min(1),
  body: z.string().min(1),
});
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
export const taskStateSchema = z.object({
  kind: z.literal("task"),
  specId: z.string(),
  key: z.string(),
  packHash: z.string(),
  sources: z.array(snapshotSchema),
  generation: z.string(),
  published: z.boolean(),
  runId: z.string().nullable(),
  stage: z.enum([
    "pending",
    "working",
    "checking",
    "reviewing",
    "integrating",
    "done",
    "blocked",
  ]),
  attempts: z.number().int(),
  epoch: z.number().int(),
  workerId: z.string().nullable(),
  reviewerId: z.string().nullable(),
  worktree: z.string().nullable(),
  base: z.string().nullable(),
  commit: z.string().nullable(),
  branch: z.string().nullable(),
  evidence: z.array(z.string()),
  dependencies: z.array(z.string()),
});
export type TaskState = z.infer<typeof taskStateSchema>;
export const runStateSchema = z.object({
  kind: z.literal("run"),
  threadId: z.string(),
  projectId: z.string(),
  hostId: z.string(),
  root: z.string(),
  specId: z.string(),
  taskIds: z.array(z.string()),
  stage: z.enum(["starting", "running", "paused", "complete", "blocked"]),
  authorizationIds: z.array(z.string()).default([]),
  branch: z.string(),
  worktree: z.string(),
  base: z.string(),
  command: z.string(),
  setupCommand: z.string(),
  worker: roleSchema,
  reviewer: roleSchema,
  startedAt: z.string(),
  error: z.string().nullable(),
});
export type RunState = z.infer<typeof runStateSchema>;
export const beadSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
});
export type Bead = z.infer<typeof beadSchema>;
export const phaseFromName = (name: string): Phase | null =>
  /requirements/i.test(name)
    ? "requirements"
    : /tasks/i.test(name)
      ? "tasks"
      : /design/i.test(name)
        ? "design"
        : null;
export const now = () => new Date().toISOString();

export const manifestKey = (documents: Pick<Snapshot, "path" | "sha256">[]) =>
  JSON.stringify(
    documents
      .map(({ path, sha256 }) => ({ path, sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
