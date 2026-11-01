# Native BB document review

Status: **first milestone complete**, installed locally on BB 0.48.1 / SDK 0.6.104.

The independently maintained mattergen-io fork owns this integration. Routine upstream synchronization is not part of development. BB owns projects, environments, threads, agents, and file access; the plugin owns document review and feedback.

## Progress

- [x] Fork created and SSH access verified.
- [x] Working checkout and integration branch created.
- [x] Native document viewer and annotation controls.
- [x] Durable review state and confined workspace file access.
- [x] Add feedback to composer, send feedback, and version-specific approval.
- [x] Refresh after agent replies and retain feedback across document changes.
- [x] Focused automated checks, build, and live BB verification.

## Automatic change highlighting follow-up

- [x] Show changes against the reviewed baseline in the normal annotatable document.
- [x] Keep removed text visible and clear highlights when the baseline resets.
- [x] Verify annotations, refresh, history, and native BB rendering; build and reload.

## Spec-set selector follow-up

- [x] Select a folder and descendants from the thread checkout; persist the selection.
- [x] Navigate a document tree with per-file and collapsed-folder pending-review indicators.
- [x] Combine current-version feedback across the set; keep Reviewed/Approve per document.
- [x] Verify persistence, stale-set protection, native BB UI, and generated agent instructions.

## Behavior

Open the thread’s **Plannotator** panel and select a checkout-relative folder as the spec set. Its Markdown files and descendants appear in a collapsible document tree; filenames are not restricted to requirements/design/tasks. The native Markdown file opener selects the file’s parent folder and opens that file. The chosen folder and last open document are remembered per thread.

The tree marks never-reviewed files **Needs review**, revised files **Changed**, and exact versions **Reviewed** or **Approved**. Folder rows retain pending counts when collapsed. Comments have a separate count. Select a file to review it in the single document viewer, using text selection, global comments, or suggested deletions.

**Add to chat** appends one combined prompt for current-version comments across the selected set, preserving the native composer’s draft and attachments. **Send feedback** queues that prompt to the same thread. Historical-version comments remain in each document’s version history and are excluded from the current combined prompt. Before preparing/sending, the backend rechecks folder membership, file contents, source identity, and saved feedback revisions; a stale set requires refresh. An unavailable document prevents an incomplete combined message.

**Reviewed** applies only to the displayed document and resets the comparison baseline without sending a message. **Approve** records the displayed content hash, resets the baseline, and sends an acknowledgment-and-wait instruction. Approval does not authorize implementation or another stage. The backend rechecks the live file, checkout identity, and feedback revision before sending.

Comments are stored per thread, checkout identity, file, and content hash in the plugin’s SQLite database. Edits produce a new review version; previous comments remain available in the version selector. Earlier versions are read-only. Concurrent feedback saves reject stale revisions; the user can explicitly discard local edits and reload the saved review. Ambiguous sends retain their operation marker and reconcile against prompt history before another send.

Thread completion/failure signals and reconnect refresh the selected set, including unopened documents. External edits can use **Refresh**. A never-reviewed document has no body change highlights. After its first Reviewed/Approved baseline exists, the main document automatically highlights changes against that baseline. Added blocks are green; edited blocks are amber, with added words highlighted inside eligible prose. Removed text is rendered below the document. There is no separate changes-view toggle. Text selection and annotations use the same document throughout; resetting the baseline clears its change paint without changing comment anchors.

## Implementation

Source: [apps/bb-plugin-plannotator](../../apps/bb-plugin-plannotator/README.md). Build from this fork’s UI/core workspace sources. Use BB’s public SDK and native composer; no standalone Plannotator process is required. Shared UI changes add optional portal placement, native clipboard routing, and a session-specific key for unfinished comment drafts. Existing UI defaults remain operational.

Plannotator CSS is generated from the fork, then scoped to the plugin’s document and portal roots. The viewer receives the actual panel scroll element. Neither its theme provider nor a second conversation UI is mounted. File validation and approval semantics adapt the existing Spec Manager approach. `spec-sets.ts` scans and summarizes the selected folder; `review-messages.ts` reuses the existing versioned review store and delivery handling for combined feedback. The existing UI path-tree builder also accepts documents without diff metadata. A project-wide library is separate from this increment.

## Verification

- 33 plugin tests pass: real SQLite persistence/reload, path confinement, stale files/checkouts/feedback, thread ownership, queueing, approval scope, duplicate suppression, uncertain-delivery recovery, composer preservation, refresh, host portals, native clipboard, public-SDK imports, recursive sets, pending indicators, combined feedback, stale-set rejection, and inventory limits.
- 42 shared-UI checks pass for path-tree construction, tree navigation, document headers, and selection actions. Earlier diff/highlight checks remain recorded in the verification artifact.
- Plugin and full shared-UI typechecks pass; the plugin builds and reloads successfully.
- Live BB checks created global and selected-text comments, verified native composer insertion, restored the composer’s empty draft, reset a baseline, rejected a stale send, refreshed an agent-produced revision, reopened its earlier comments, and rendered the comparison, TypeScript fence, and Mermaid diagram.
- The automatic-highlighting follow-up also verified a selected-text comment on changed prose, clearing paint and removals with Reviewed while preserving that comment, and restoring it with the change paint after reload. Native range highlights add no text wrappers; browsers without that API retain block-level paint.
- The selector follow-up matched Graze’s complete 20-document spec hierarchy, exercised two-document composer feedback and restored the empty draft without sending, verified collapsed pending counts and reload persistence, and confirmed a first-time document has zero body highlights.
- Fresh agents in scratch folders followed the actual generated messages: feedback revised only the Markdown file; approval acknowledged and waited without changing files. The combined-feedback agent revised both commented spec documents and left implementation code and supporting evidence unchanged.

Reproducible commands and recorded outcomes: [verification.json](../../apps/bb-plugin-plannotator/evidence/verification.json). Actual generated messages: [generated-messages.json](../../apps/bb-plugin-plannotator/evidence/generated-messages.json). Captured native panels: [spec set with pending review](../../apps/bb-plugin-plannotator/assets/native-spec-set.jpg) and [first-time document without highlights](../../apps/bb-plugin-plannotator/assets/native-spec-set-new.jpg).

Successful live agent-message delivery was not exercised; that contract and automatic refresh were verified through the SDK harness.

## First-milestone limits

A spec set supports up to 200 UTF-8 `.md` / `.markdown` documents, each up to 256 KiB. Annotations are limited to 128 KiB per version and a combined feedback prompt to 128 KiB. Incomplete inventories are rejected instead of silently dropping documents. The version selector lists the 30 most recently updated snapshots; older rows remain stored. Image attachment/upload support and workspace-relative image routing are not implemented. File changes are refreshed after agent replies or manually, rather than watched continuously. A checkout change opens a separate review identity; carrying spec folders is not included.

This is a local development installation. Git/npm release packaging and factory orchestration are later work.
