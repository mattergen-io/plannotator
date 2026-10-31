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

## Behavior

Open a Markdown file from a thread’s right-panel **Plannotator** action, or through BB’s native Markdown file opener. The file comes from that thread’s current checkout. Select text, use a global comment, or suggest a deletion with Plannotator’s existing controls. **Add to chat** appends the generated review prompt to the native composer, preserving its draft and attachments. **Send feedback** queues that prompt to the same thread. An active agent receives it through BB’s normal queue.

**Reviewed** resets the comparison baseline without sending a message. **Approve** records the displayed content hash, resets the baseline, and sends an acknowledgment-and-wait instruction. Approval does not authorize implementation or another stage. The backend rechecks the live file, checkout identity, and feedback revision before sending.

Comments are stored per thread, checkout identity, file, and content hash in the plugin’s SQLite database. Edits produce a new review version; previous comments remain available in the version selector. Earlier versions are read-only. Concurrent feedback saves reject stale revisions; the user can explicitly discard local edits and reload the saved review. Ambiguous sends retain their operation marker and reconcile against prompt history before another send.

Thread completion/failure signals and reconnect refresh the saved file. External edits can use **Refresh**. The changes view compares against the last Reviewed/Approved baseline using Plannotator’s existing diff renderer.

## Implementation

Source: [apps/bb-plugin-plannotator](../../apps/bb-plugin-plannotator/README.md). Build from this fork’s UI/core workspace sources. Use BB’s public SDK and native composer; no standalone Plannotator process is required. Shared UI changes add optional portal placement, native clipboard routing, and a session-specific key for unfinished comment drafts. Existing UI defaults remain operational.

Plannotator CSS is generated from the fork, then scoped to the plugin’s document and portal roots. The viewer receives the actual panel scroll element. Neither its theme provider nor a second conversation UI is mounted. File validation and approval semantics adapt the existing Spec Manager approach; the project/spec library is separate from this milestone.

## Verification

- 18 plugin tests pass: real SQLite persistence/reload, path confinement, stale files/checkouts/feedback, thread ownership, queueing, approval scope, duplicate suppression, uncertain-delivery recovery, composer preservation, refresh, host portals, native clipboard, and public-SDK imports.
- 40 existing shared-UI tests pass for toolbar selection actions, document headers, forced comment dialogs, and clipboard defaults.
- Plugin and full shared-UI typechecks pass; the plugin builds and reloads successfully.
- Live BB checks created global and selected-text comments, verified native composer insertion, restored the composer’s empty draft, reset a baseline, rejected a stale send, refreshed an agent-produced revision, reopened its earlier comments, and rendered the comparison, TypeScript fence, and Mermaid diagram.
- Fresh agents in scratch folders followed the actual generated messages: feedback revised only the Markdown file; approval acknowledged and waited without changing files.

Reproducible commands and recorded outcomes: [verification.json](../../apps/bb-plugin-plannotator/evidence/verification.json). Actual generated messages: [generated-messages.json](../../apps/bb-plugin-plannotator/evidence/generated-messages.json). Captured native panels: [review history](../../apps/bb-plugin-plannotator/assets/native-review.jpg) and [changes](../../apps/bb-plugin-plannotator/assets/native-changes.jpg).

Successful live agent-message delivery was not exercised; that contract and automatic refresh were verified through the SDK harness.

## First-milestone limits

UTF-8 `.md` / `.markdown` files are limited to 256 KiB and annotations to 128 KiB per version. The version selector lists the 30 most recently updated snapshots; older rows remain stored. Image attachment/upload support and workspace-relative image routing are not implemented. File changes are refreshed after agent replies or manually, rather than watched continuously. A checkout change opens a separate review identity; carrying spec folders is not included.

This is a local development installation. Git/npm release packaging and factory orchestration are later work.
