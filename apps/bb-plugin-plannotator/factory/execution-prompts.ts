import type { TaskState, RunState } from "./model";
export function workerPrompt(
  id: string,
  task: TaskState,
  run: RunState,
  pack: string,
) {
  return `You are implementing Beads task ${id} for factory run ${task.runId}. Your assigned worktree is ${task.worktree}. Read its applicable AGENTS.md instructions. This task has already been accepted and execution authorized.\n\n${pack}\n\nImplement only this task's responsibilities, using prerequisite work already integrated in your base. Run the task's relevant verification and the run check: ${JSON.stringify(run.command)}. Do not edit the spec documents, Beads state, Git hooks, or other worktrees. Do not commit, push, start another agent, or mark the bead complete; merge the current factory branch into this worktree only when an explicit integration-conflict correction below requests it; the factory handles those steps after verification and independent review. If context is missing, report it rather than expanding scope. Finish with the result, files changed, and actual verification evidence.\n\nPrevious attempt evidence:\n${task.evidence.slice(-3).join("\n\n")}`;
}
export function reviewerPrompt(
  id: string,
  task: TaskState,
  run: RunState,
  pack: string,
) {
  return `Independently review Beads task ${id}. Worktree: ${task.worktree}. Accepted context pack:\n\n${pack}\n\nRead applicable repository instructions. Inspect the actual code and tests against the responsibilities, requirements, and acceptance criteria. Review the task changes with git diff ${task.base}...${task.commit}. The factory ran ${JSON.stringify(run.command)}; inspect its evidence below and run additional read-only checks as useful. Do not modify source/specs, commit, merge, launch other agents, or update Beads. Reject missing behavior or inadequate tests even if the existing checks passed.\n\n${task.evidence.slice(-2).join("\n\n")}\n\nReport actionable findings with file locations. The final nonempty line must be exactly FACTORY_REVIEW: PASS if no blocking findings remain, or FACTORY_REVIEW: CHANGES if corrections are required. Never emit PASS merely because the worker says it is done.`;
}
