import { readFile, writeFile } from "node:fs/promises";
const css = await readFile(new URL("../../../packages/ui/styles.css", import.meta.url), "utf8");
// Scope Plannotator's existing styles, including Tailwind preflight, to its own surfaces.
// :root's token defaults belong to each scope root instead of BB's document root.
await writeFile(new URL("../document-styles.css", import.meta.url), `@scope (.bb-plannotator-ui) {\n${css.replace(/:root\b/g, ":scope")}\n}\n`);
