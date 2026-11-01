import {
  taskDefinitionSchema,
  type TaskDefinition,
  type Snapshot,
} from "./model";
import { hash } from "../workspace";

export function parseTasks(markdown: string): TaskDefinition[] {
  const starts = [
    ...markdown.matchAll(/^##\s+([A-Za-z][A-Za-z0-9_-]{0,63}):\s*(.+)$/gm),
  ];
  if (!starts.length)
    throw new Error("Give each task a heading such as ‘## T1: Task title’.");
  const tasks = starts.map((match, index) => {
    const body = markdown
      .slice(match.index!, starts[index + 1]?.index ?? markdown.length)
      .trim();
    const section = (name: string) => {
      const found = new RegExp(
        `^### ${name}\\s*$([\\s\\S]*?)(?=^### |$(?![\\s\\S]))`,
        "mi",
      ).exec(body);
      const value = found?.[1].trim() ?? "";
      if (!value) throw new Error(`${match[1]} needs a ${name} section.`);
      return value;
    };
    const refs = (name: string) =>
      section(name)
        .split(/\n/)
        .map((line) =>
          line
            .replace(/^\s*[-*]\s+/, "")
            .replace(/^`|`$/g, "")
            .trim(),
        )
        .filter(Boolean);
    return taskDefinitionSchema.parse({
      key: match[1],
      title: match[2],
      body,
      responsibilities: section("Responsibilities"),
      requirements: refs("Requirements"),
      design: refs("Design"),
      dependencies: section("Dependencies").match(
        /^(none|no dependencies)\.?$/i,
      )
        ? []
        : section("Dependencies")
            .split(/[\s,]+/)
            .map((x) => x.replace(/^[`*-]+|[`;.]+$/g, ""))
            .filter(Boolean),
      acceptance: section("Acceptance"),
      verification: section("Verification"),
    });
  });
  const keys = new Set(tasks.map((t) => t.key));
  if (keys.size !== tasks.length)
    throw new Error("Task identifiers must be unique.");
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(key: string) {
    if (visiting.has(key))
      throw new Error(`Task dependencies contain a cycle at ${key}.`);
    if (visited.has(key)) return;
    const task = tasks.find((t) => t.key === key);
    if (!task) throw new Error(`Missing prerequisite task ${key}.`);
    visiting.add(key);
    task.dependencies.forEach(visit);
    visiting.delete(key);
    visited.add(key);
  }
  tasks.forEach((t) => visit(t.key));
  return tasks;
}
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
function excerpt(reference: string, documents: Snapshot[]) {
  const [file, fragment] = reference.split("#");
  const candidates = documents.filter(
    (doc) => doc.path === file || doc.path.endsWith(`/${file}`),
  );
  if (candidates.length !== 1)
    throw new Error(
      `Source ${reference} must identify one accepted document. Use its full project-relative path.`,
    );
  const document = candidates[0];
  if (!fragment) return { document, content: document.content };
  const headings = [...document.content.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  const found = headings.findIndex((h) => slug(h[2]) === slug(fragment));
  if (found < 0)
    throw new Error(
      `Source section ${reference} does not exist in the accepted document.`,
    );
  const heading = headings[found];
  const end =
    headings.slice(found + 1).find((h) => h[1].length <= heading[1].length)
      ?.index ?? document.content.length;
  return {
    document,
    content: document.content.slice(heading.index!, end).trim(),
  };
}
export function contextPack(
  task: TaskDefinition,
  accepted: Snapshot[],
  ancestors: Snapshot[] = [],
) {
  const inherited = ancestors
    .filter(
      (doc) =>
        !task.requirements.some((ref) => {
          const file = ref.split("#")[0];
          return doc.path === file || doc.path.endsWith(`/${file}`);
        }),
    )
    .map((doc) => doc.path);
  const selected = [...task.requirements, ...task.design, ...inherited].map(
    (ref) => ({
      ref,
      ...excerpt(ref, accepted),
    }),
  );
  const sources = [
    ...new Map(selected.map((s) => [s.document.path, s.document])).values(),
  ];
  const text = `# ${task.key}: ${task.title}\n\n${task.body}\n\n## Accepted source context\n\n${selected.map((s) => `### ${s.ref}\nSHA-256: ${s.document.sha256}\n\n${s.content}`).join("\n\n")}\n\n## Responsibility contract\nWork only on this task’s responsibilities. Honor applicable repository instructions in the execution checkout. Consume prerequisite outputs rather than reimplementing their responsibilities. Report missing or contradictory context; do not silently broaden scope.\n`;
  if (Buffer.byteLength(text) > 64000)
    throw new Error(
      `${task.key}'s pack exceeds 64 KiB. Reference narrower accepted source sections or split the task.`,
    );
  return {
    text,
    sources: sources.map((s) => ({
      ...s,
      content: selected
        .filter((x) => x.document.path === s.path)
        .map((x) => x.content)
        .join("\n\n"),
    })),
    hash: hash(text),
  };
}
export const taskAuthoringInstructions = `Write a single Tasks Markdown document. Each task uses ‘## T1: Task title’ with a stable identifier, followed by these nonempty sections: ‘### Responsibilities’, ‘### Requirements’, ‘### Design’, ‘### Dependencies’, ‘### Acceptance’, ‘### Verification’. Requirements and Design each list accepted project-relative document paths, optionally followed by #heading-slug, one per line. Dependencies lists task identifiers separated by commas or the word None. Responsibilities states owned behavior, deliverables, handoffs, and boundaries. Acceptance gives observable completion criteria. Verification gives concrete commands/checks. These sections become the task context pack, so resolve missing decisions before presenting Tasks for acceptance. Do not start implementation.`;
