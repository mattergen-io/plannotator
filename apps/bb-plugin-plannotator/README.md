# Plannotator for BB

Native document review built from this fork’s UI/core workspace sources. BB owns the conversation and file access; Plannotator renders and annotates the document.

Open **Plannotator** in a thread’s side-panel tabs and choose a spec from the left **Spec sets** tree. Only folders with their own `requirements.md` appear. A spec nests beneath its nearest qualifying ancestor; README-only containers are skipped in this selector. For Graze, blocks 01–04 nest directly beneath `graze-framework`, and A1–A4 beneath 01.

The document tree below it uses the selected spec as its base and shows every folder and file, including empty directories. Markdown documents open in the review viewer on the right; supporting files use BB’s native preview. The selection and last open document are remembered per thread. The native Markdown opener chooses the closest owning spec when one exists.
Review actions sit in a compact header with **Review version** at the upper right. The document toolbar and title follow directly below.

The tree shows **Needs review**, **Changed**, **Reviewed**, or **Approved**, plus comment counts and pending counts on collapsed folders. Never-reviewed documents have no body highlights. Once Reviewed/Approve establishes a document’s baseline, subsequent changes appear automatically in the viewer.

**Add to chat** and **Send feedback** combine current-version comments across the set into one prompt. **Reviewed** and **Approve** apply only to the displayed document; they reset its baseline while preserving comments. Approval tells the agent to acknowledge and wait. Stale set membership, files, feedback revisions, or checkout identity require a refresh before combined feedback can be sent.

Feedback is stored per thread, working-folder identity, document, and content hash. Earlier review versions remain available when an agent edits the file. File changes and working-folder moves invalidate direct send/approval until refresh. Existing composer drafts and attachments are preserved.

## Development

From the fork root:

```sh
bun install --filter bb-plugin-plannotator --ignore-scripts
bun run --cwd apps/bb-plugin-plannotator build
bb plugin install ./apps/bb-plugin-plannotator --yes
```

Progress and verification: [BB integration guide](../../docs/agent-guides/bb-plugin.md).

A set supports up to 200 UTF-8 `.md` / `.markdown` documents, each up to 256 KiB, with 128 KiB of annotations per version and 128 KiB per combined feedback prompt. Files remain in their BB checkout. A folder change opens a separate review identity; this plugin does not carry spec folders. Sends queue behind active agent turns. A failed send is recorded as uncertain; check delivery before explicitly resending.

## Native BB captures

Captured from a running BB panel using a disposable Graze-shaped example. The spec selector omits the README-only `blocks` ancestor; the separate file tree preserves actual folders and supporting files. Never-reviewed documents remain unhighlighted.

![Requirements-based spec selector and left document tree](assets/native-spec-navigation.jpg)

[Compact review header, wide panel](assets/native-compact-review-wide.jpg) · [Narrow panel](assets/native-compact-review-narrow.jpg)

## Verification

The plugin has 36 passing focused tests and 43 passing shared-UI regression checks, with passing plugin and shared-UI typechecks. See [recorded commands and outcomes](evidence/verification.json) and [generated agent messages](evidence/generated-messages.json).

For a standalone sample in this checkout, open `apps/bb-plugin-plannotator/fixtures/document-review.md`. This milestone is installed from a development checkout; Git/npm release packaging, image attachment/upload support, and workspace-relative image routing are not included.

The SDK’s SQLite test harness needs a native binding. After an install with scripts disabled, run `npm rebuild better-sqlite3 --ignore-scripts=false` from the plugin directory before running its tests.
