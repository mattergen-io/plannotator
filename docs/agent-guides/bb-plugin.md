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

## Spec navigation correction

- [x] Discover selectable specs from folders containing their own `requirements.md`; omit other ancestors.
- [x] Replace the path field with a spec hierarchy and move document navigation left of the viewer.
- [x] Show all entries beneath the selected spec, including non-Markdown files and empty folders.
- [x] Verify Graze’s hierarchy, layout, review state, and native file previews.

## Review layout spacing follow-up

- [x] Remove the duplicate file/status row and place review history at the upper right of the action header.
- [x] Tighten the document toolbar and title spacing with host-scoped styles.
- [x] Build/reload and verify wide and narrow panel layouts.

## Behavior

Open the thread’s **Plannotator** panel and choose a spec in the left **Spec sets** tree. A spec is a folder containing its own `requirements.md`. Each spec nests under its nearest ancestor that also has that file. Other ancestors are omitted from this selector: Graze’s README-only `blocks` folder is skipped, putting blocks 01–04 directly under `graze-framework`, with A1–A4 under 01. Discovery scans the thread’s checkout, including hidden spec folders.

Below the selector, the left document tree shows every directory and file under the selected spec as its base, preserving the actual filesystem hierarchy and empty folders. Markdown documents open in the single review viewer on the right; other files open through BB’s native preview. Changing the selected spec changes this base. The chosen spec and last open document are remembered per thread. The native Markdown opener chooses the nearest discovered owning spec; a standalone Markdown file can still open in its containing folder.
The tree marks never-reviewed files **Needs review**, revised files **Changed**, and exact versions **Reviewed** or **Approved**. Folder rows retain pending counts when collapsed. Comments have a separate count. Select a file to review it in the single document viewer, using text selection, global comments, or suggested deletions.

**Add to chat** appends one combined prompt for current-version comments across the selected set, preserving the native composer’s draft and attachments. **Send feedback** queues that prompt to the same thread. Historical-version comments remain in each document’s version history and are excluded from the current combined prompt. Before preparing/sending, the backend rechecks folder membership, file contents, source identity, and saved feedback revisions; a stale set requires refresh. An unavailable document prevents an incomplete combined message.

**Reviewed** applies only to the displayed document and resets the comparison baseline without sending a message. **Approve** records the displayed content hash, resets the baseline, and sends an acknowledgment-and-wait instruction. Approval does not authorize implementation or another stage. The backend rechecks the live file, checkout identity, and feedback revision before sending.

Comments are stored per thread, checkout identity, file, and content hash in the plugin’s SQLite database. Edits produce a new review version; previous comments remain available in the version selector. Earlier versions are read-only. Concurrent feedback saves reject stale revisions; the user can explicitly discard local edits and reload the saved review. Ambiguous sends retain their operation marker and reconcile against prompt history before another send.

Thread completion/failure signals and reconnect refresh the selected set, including unopened documents. External edits can use **Refresh**. A never-reviewed document has no body change highlights. After its first Reviewed/Approved baseline exists, the main document automatically highlights changes against that baseline. Added blocks are green; edited blocks are amber, with added words highlighted inside eligible prose. Removed text is rendered below the document. There is no separate changes-view toggle. Text selection and annotations use the same document throughout; resetting the baseline clears its change paint without changing comment anchors.

Review actions and history share a compact header, with **Review version** at the upper right. The duplicate file/save-status strip is removed; transient save progress stays inline. Host-scoped spacing brings the document toolbar and title up without changing standalone Plannotator styling.

## Implementation

Source: [apps/bb-plugin-plannotator](../../apps/bb-plugin-plannotator/README.md). Build from this fork’s UI/core workspace sources. Use BB’s public SDK and native composer; no standalone Plannotator process is required. Shared UI changes add optional portal placement, native clipboard routing, and a session-specific key for unfinished comment drafts. Existing UI defaults remain operational.

Plannotator CSS is generated from the fork, then scoped to the plugin’s document and portal roots. The viewer receives the actual panel scroll element. Neither its theme provider nor a second conversation UI is mounted. File validation and approval semantics adapt the existing Spec Manager approach. `spec-sets.ts` scans and summarizes the selected folder; `review-messages.ts` reuses the existing versioned review store and delivery handling for combined feedback. The existing UI path-tree builder accepts documents without diff metadata and explicit directory entries; optional flags preserve every filesystem level without changing existing diff-tree defaults. A project-wide library is separate from this increment.

## Verification

- 36 plugin tests pass: real SQLite persistence/reload, path confinement, stale files/checkouts/feedback, thread ownership, queueing, approval scope, duplicate suppression, uncertain-delivery recovery, composer preservation, refresh, host portals, native clipboard, public-SDK imports, recursive sets, pending indicators, combined feedback, stale-set rejection, inventory limits, requirements-only hierarchy, empty directories, base selection, and native supporting-file links.
- 43 shared-UI checks pass for path-tree construction, tree navigation, document headers, and selection actions. Earlier diff/highlight checks remain recorded in the verification artifact.
- Plugin and full shared-UI typechecks pass; the plugin builds and reloads successfully.
- Live BB checks created global and selected-text comments, verified native composer insertion, restored the composer’s empty draft, reset a baseline, rejected a stale send, refreshed an agent-produced revision, reopened its earlier comments, and rendered the comparison, TypeScript fence, and Mermaid diagram.
- The automatic-highlighting follow-up also verified a selected-text comment on changed prose, clearing paint and removals with Reviewed while preserving that comment, and restoring it with the change paint after reload. Native range highlights add no text wrappers; browsers without that API retain block-level paint.
- The selector follow-up matched Graze’s complete 20-document spec hierarchy, exercised two-document composer feedback and restored the empty draft without sending, verified collapsed pending counts and reload persistence, and confirmed a first-time document has zero body highlights.
- The navigation correction verified Graze’s nine selectable specs and their exact nearest-spec parents, removed the path input, checked that the navigation is left of the viewer, preserved `blocks` in the physical file tree, and opened a supporting JSON file in BB’s native editor.
- Fresh agents in scratch folders followed the actual generated messages: feedback revised only the Markdown file; approval acknowledged and waited without changing files. The combined-feedback agent revised both commented spec documents and left implementation code and supporting evidence unchanged.

Reproducible commands and recorded outcomes: [verification.json](../../apps/bb-plugin-plannotator/evidence/verification.json). Actual generated messages: [generated-messages.json](../../apps/bb-plugin-plannotator/evidence/generated-messages.json). Current native panel: [requirements-based spec navigation](../../apps/bb-plugin-plannotator/assets/native-spec-navigation.jpg). Compact review header: [wide](../../apps/bb-plugin-plannotator/assets/native-compact-review-wide.jpg) and [narrow](../../apps/bb-plugin-plannotator/assets/native-compact-review-narrow.jpg). Earlier selector and highlighting captures remain in the evidence history.

Successful live agent-message delivery was not exercised; that contract and automatic refresh were verified through the SDK harness.

## First-milestone limits

A spec set supports up to 200 UTF-8 `.md` / `.markdown` documents, each up to 256 KiB. Annotations are limited to 128 KiB per version and a combined feedback prompt to 128 KiB. Incomplete inventories are rejected instead of silently dropping documents. The version selector lists the 30 most recently updated snapshots; older rows remain stored. Image attachment/upload support and workspace-relative image routing are not implemented. File changes are refreshed after agent replies or manually, rather than watched continuously. A checkout change opens a separate review identity; carrying spec folders is not included.

This is a local development installation. Git/npm release packaging and factory orchestration are later work.
