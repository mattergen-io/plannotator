import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const documentPath = z.string().min(1).max(1024).refine(value =>
  !/[\x00-\x1f\\:]/.test(value) && !value.startsWith("/") &&
  !value.split("/").some(part => part === ".." || part.toLowerCase() === ".git"),
  "Choose a relative Markdown path inside this thread’s checkout.",
).transform(value => value.split("/").filter(part => part && part !== ".").join("/"))
  .refine(value => /\.(md|markdown)$/i.test(value), "Choose a .md or .markdown file.");
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const annotation = z.object({
  id: z.string().min(1).max(200), blockId: z.string().max(300),
  startOffset: z.number().int().nonnegative(), endOffset: z.number().int().nonnegative(),
  type: z.enum(["COMMENT", "GLOBAL_COMMENT", "DELETION"]),
  originalText: z.string().max(65536), text: z.string().max(16384).optional(), createdA: z.number().finite(),
}).passthrough();
export const annotationsSchema = z.array(annotation).max(500)
  .refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 128 * 1024, "Feedback exceeds 128 KiB.");
const version = z.object({ sha256: sha, updatedAt: z.string(), commentCount: z.number(), approvedAt: z.string().nullable() });
export const documentSchema = z.object({
  id: sha, threadId: z.string(), path: z.string(), hostId: z.string(), checkoutRoot: z.string(), environmentId: z.string(),
  sha256: sha, currentSha256: sha, content: z.string(), annotations: annotationsSchema,
  revision: z.number().int(), baseline: z.string().nullable(), approvedAt: z.string().nullable(), versions: z.array(version),
});
export type ReviewDocument = z.infer<typeof documentSchema>;
const target = z.object({ threadId: z.string().min(1), id: sha, sha256: sha, revision: z.number().int().nonnegative() }).strict();
export type ReviewTarget = z.infer<typeof target>;
export const targetOf = (doc: ReviewDocument): ReviewTarget => ({ threadId: doc.threadId, id: doc.id, sha256: doc.sha256, revision: doc.revision });
const action = z.enum(["feedback", "approve"]);
export const CHANNEL = "document-review";
export const TAB = { id: "document-review", context: { kind: "thread" as const }, availability: "action" as const };
export const rpcContract = defineRpcContract({
  session: { input: z.object({ threadId: z.string().min(1) }).strict(), output: z.object({ path: z.string().nullable(), files: z.array(z.string()), truncated: z.boolean() }) },
  open: { input: z.object({ threadId: z.string().min(1), path: documentPath, sha256: sha.optional() }).strict(), output: documentSchema },
  save: { input: target.extend({ annotations: annotationsSchema }), output: z.object({ revision: z.number().int() }) },
  prepare: { input: target.extend({ action }), output: z.object({ text: z.string() }) },
  send: { input: target.extend({ action, resend: z.boolean().optional() }), output: z.object({ status: z.enum(["sent", "uncertain"]), error: z.string().nullable() }) },
  reviewed: { input: target, output: z.object({ ok: z.literal(true) }) },
});
