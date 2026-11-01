# BB factory

Status: **implemented, installed locally, and verified**.
The factory extends the independently maintained native BB Plannotator plugin.
The fixed pipeline is Requirements → Design → Tasks → implementation → checks →
independent review → integration. Beads owns its work, dependencies, claims, phase
facts, and durable outcomes. BB owns threads, providers, environments, and execution.

## Confirmed policy

- Requirements and Tasks each have one review document, with the respective word
  in its filename. Design may have multiple documents. Other files can be references.
- Reviewed records the exact current document hash and resets its diff baseline.
  It sends no message. Accept applies to the entire current phase and requires all
  its documents to have current review marks.
- At every Requirements boundary, the agent assesses size and the user chooses
  Continue to Design or Break into child specs. The assessment is tied to the
  reviewed Requirements version. A decomposed parent stays at accepted Requirements;
  children plan independently and may split again. The existing chat creates children.
- Accepting Requirements/Design sends the next drafting instruction through the
  native thread. Accepting Tasks publishes Beads tasks and context packs, then waits.
  A separate Start factory action authorizes execution.
- A run finishes the selected published work, including selected descendant specs,
  then stops. It runs at most two implementation tasks concurrently. Native BB
  thread capacity still applies.
- Each task gets an isolated Git worktree. Checks must pass before a separate
  reviewer inspects the actual code and tests. Two correction rounds are allowed;
  a further failure blocks that bead while independent work continues.
- Passing tasks merge into a per-run factory branch, with verification after each
  merge. The starting branch is unchanged. There is no deployment or merge to main.
- Worker: **Codex gpt-6.1-terra / medium**. Reviewer: **Codex gpt-6.1-sol / xhigh**.
  Native BB model pickers permit changes before Start; the run records its choices.

## Native review and planning

Open Plannotator in the thread's right panel. The Spec sets tree lists folders with
an own Markdown document whose filename contains `requirements`. Specs nest under
nearest qualifying ancestors; README-only containers are omitted from this selector.
The physical document tree preserves all folders and files under the chosen spec.
Each child owns its documents even when viewed through its parent's file tree.

Beads is initialized automatically when the spec workflow first needs it. Setup uses
the existing `bd` installation with `--init-if-missing`, `--skip-agents`, `--skip-hooks`,
and `--non-interactive`. Existing workspaces are reused; unusable workspaces and other
Beads errors are reported without reinitialization. An imported spec suggests a phase
and displays editable document memberships. Starting in Design/Tasks requires explicit acceptance
of the current earlier documents. The backend rechecks the exact confirmed inventory.

New spec takes an idea, creates a Beads spec identity, and asks the current thread
to draft Requirements. After a reply, discovery refreshes and selects the new folder.
Phase actions live in the compact workflow bar; expandable details contain membership,
acceptance history, context-pack previews, and run controls. The document viewer,
annotations, combined feedback, native composer, and review history remain shared.

New documents receive membership as they are discovered; standard phase filenames
retain their role. Unclassified documents join Design while it is current, otherwise
remain references until explicitly assigned. Requirements/Tasks cardinality and naming
are checked on acceptance. New-since-last-acceptance markers identify added documents.
Never-reviewed files show Needs review in the tree without painting their whole body.

Editing accepted source reopens the earliest affected phase and clears downstream
review marks. Acceptance history and old task generations remain available. Obsolete
unstarted tasks are blocked; a revised Tasks acceptance publishes a new generation.
Live execution pauses when pinned source or planning checkout changes. Stop preserves
worktrees and evidence; reopen/reaccept the affected work to publish a fresh set.

## Task packs and publication

The agent writes one Tasks document. Each task uses `## T1: Title` followed by nonempty
`### Responsibilities`, `Requirements`, `Design`, `Dependencies`, `Acceptance`, and
`Verification` sections. Source sections list accepted project-relative paths, optionally
with `#heading-slug`. Dependencies list task keys separated by commas, or `None`.
The drafting instruction supplies this structure; users do not fill out a workflow wizard.

Preview validates unique keys, references, and an acyclic dependency graph before
acceptance. Packs include the reviewed task body, owned responsibilities/boundaries,
deliverables, handoffs, checks, accepted source excerpts and SHA-256 hashes. Applicable
accepted ancestor Requirements are included. Missing context prevents publication;
acceptance never invents additional task scope.

A task's native Beads description is its context pack. Namespaced metadata pins its
hash, source manifest, spec identity/generation, run association, attempts, threads,
worktree, lifecycle, and evidence. The plugin does not maintain a second task graph.
Packs are limited to 64 KiB; reference narrower sections or split oversized tasks.

Tasks acceptance first records a durable publishing intent, creates deterministic
Beads task IDs, and adds a native authorization gate plus task dependency edges.
Only a verified complete publication is marked Ready. A partial failure remains
publishing and can resume without duplicate beads or an extra acceptance. Published
tasks remain blocked by the unresolved gate until Start. Pause reopens that gate;
Resume rechecks authority before resolving it.

## Execution and recovery

Start validates live provider/model/effort choices, current accepted sources and packs,
and a clean committed starting checkout. Optional workspace setup and required
verification commands are user-selected run inputs. Setup runs in integration and
task worktrees; checks run after worker turns and again on merged code.

The run creates `factory/<run-bead-id>` in a sibling `.factory/<run-id>/integration`
worktree. Task branches use `factory-task/<run-id>/<task-bead-id>`. Beads `ready` decides
eligibility. Atomic status/assignee preconditions claim each task before dispatch.
The worker receives its accepted pack and applicable repository instructions. The
reviewer receives that pack, the exact base/commit diff, and actual check evidence.
Only a final `FACTORY_REVIEW: PASS`, a clean unchanged reviewed tree, and passing
integrated checks permit completion. Accepted-spec changes in a worker tree are
rejected before its implementation is committed or sent for review.

The five-second background service checks registered run locations and reloads
state from Beads. After confirming that a location has no starting or running runs,
it removes that location from the polling registry. Starting, resuming, or retrying
a run registers it again; errors keep the location registered for retry. Deterministic thread titles reconcile spawn intents after restart.
Persisted stages recover check/review/integration steps. Completion records precede
native bead closure so interrupted closure can be retried. Merge conflicts and failed
checks/reviews spend the same two-correction budget. Explicit Retry starts a new
budget and thread epoch; Stop keeps partial work and blocks obsolete uncompleted work.

Review snapshots/comments/baselines and durable message delivery reuse the existing
plugin SQLite store. That database is not the factory's work authority. A small BB KV
list locates repositories to recover; it does not contain task readiness or outcomes.
Commands run on the thread's BB host using the public host-entry/RPC SDK. Beads is
accessed through its CLI, not Dolt internals or a JSONL export.

## Source map

| Files under `apps/bb-plugin-plannotator/` | Responsibility |
| --- | --- |
| `host.ts`, `host-contract.ts` | Host-routed Git, Beads and approved command execution. |
| `factory/model.ts`, `factory/beads.ts` | Validated Beads records and CLI operations. |
| `factory/planning-state.ts`, `factory/planning.ts` | Inventories, phase membership, review facts, imports and drafting. |
| `factory/acceptance.ts`, `factory/publication-plan.ts`, `factory/tasks.ts` | Acceptance, source/pack validation and recoverable publication. |
| `factory/run-start.ts`, `factory/run-authority.ts` | Run creation, model selection, pinned-source authority and gates. |
| `factory/execution.ts`, `factory/execution-steps.ts` | Fixed scheduler, claims, threads, correction budget and integration. |
| `factory/controls.tsx`, `factory/import-spec.tsx`, `factory/phase-documents.tsx`, `factory/run-controls.tsx` | Native phase, import, pack, run and evidence controls. |
| `message-delivery.ts` | Shared durable phase/feedback delivery and reconciliation. |

## Progress and evidence

- [x] Host-routed Beads operations, isolated setup and real CLI contract probes.
- [x] Versioned phases, exact document review, import and drafting instructions.
- [x] Requirements sizing, recursive spec ownership and Requirements-only parents.
- [x] Validated context-pack previews and recoverable gated task publication.
- [x] Two-task scheduler, actual worker/reviewer threads, corrections and integration.
- [x] Native phase/model/run controls and completed-task evidence.
- [x] Disposable live project: agent-authored Requirements, Design and Tasks; synthetic
  review/acceptance; three tasks, two parallel workers, a controlled one-time check
  failure, independent reviews, dependent task, factory branch, all beads closed.
- [x] Independent final verification: six project tests and 35 additional API assertions;
  starting branch/HEAD, spec documents, guard and baseline preserved; both worktrees clean.
- [x] Final regression suite and native wide/narrow UI verification after final fixes.


Live evidence: [factory-live.json](../../apps/bb-plugin-plannotator/evidence/factory-live.json).
The retained project is **BB Factory acceptance**, planner `thr_jubxaf3ew4`, run
`bf-77c165ddcb1b7005976d`. Thread request events record the actual worker/reviewer
model and effort. Review final outputs, task hashes, correction evidence, changed-file
boundaries and Git results are recorded in that artifact. Synthetic approvals applied
only to this disposable project; real Graze files and Beads data were not changed.

Reproduce automated checks from the fork root:

```sh
bun run --cwd apps/bb-plugin-plannotator typecheck
bun run --cwd apps/bb-plugin-plannotator test
bun test tests/agents-md-size.test.ts
bun run --cwd apps/bb-plugin-plannotator build
bb plugin reload plannotator --json
```

The backend tests use real temporary Git and Beads workspaces with controlled BB
agent turns. They are distinct from the retained live project with actual Codex turns.
Final checks: [factory-verification.json](../../apps/bb-plugin-plannotator/evidence/factory-verification.json).
The complete plugin suite has 50 passing tests; the final two planning fixes were
rechecked with the eight affected planning tests and focused execution source-guard test. Typecheck, three root guidance
checks, build, reload, and native post-reload status passed. Panel captures:
[wide](../../apps/bb-plugin-plannotator/assets/native-factory-complete-wide.jpg) and
[narrow](../../apps/bb-plugin-plannotator/assets/native-factory-complete-narrow.jpg).
The retained live check can be rerun using the exact command in the verification artifact.

## Current limits

The live acceptance project exercises Linux, Beads 1.3.0 and the configured local BB
host. Factory inventories are capped at 1,000 labeled beads; document limits remain
those of native review. Beads and repository toolchains must already be installed.
This is a development-checkout installation, not a marketplace release.

Phase state belongs to its associated planning thread and checkout. Another thread
can view the documents but must open the associated thread for phase actions.
Automatic draft carry between changed checkout folders, project-wide unassociated
spec management, image uploads, and workspace-relative image routing are not included.
Factory branches/worktrees are retained for inspection; automatic cleanup, deployment,
continuous watching and a generic graph editor are outside this fixed pipeline.

## Reference implementations

The user's planning/product references are [AWS AI-DLC](https://github.com/awslabs/aidlc-workflows)
and their own Requirements/Design/Tasks process. The chosen execution reference is
[aws-samples/sample-kiro-factory](https://github.com/aws-samples/sample-kiro-factory),
particularly its [README](https://github.com/aws-samples/sample-kiro-factory/blob/main/README.md),
[HOWTO](https://github.com/aws-samples/sample-kiro-factory/blob/main/HOWTO.md), and
[library](https://github.com/aws-samples/sample-kiro-factory/tree/main/library).
These informed the fixed execution loop; the implementation uses native BB threads
and Beads authority rather than adopting another factory runtime or phase taxonomy.
