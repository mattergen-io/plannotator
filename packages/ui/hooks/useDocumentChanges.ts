import { useEffect, useId, type RefObject } from 'react';
import { diffChars } from 'diff';
import type { Block } from '../types';
import { computePlanDiff, type InlineDiffToken, type PlanDiffBlock } from '../utils/planDiffEngine';

/** A missing final newline must not turn the unchanged final paragraph into a rewrite. */
export const computeDocumentChanges = (baseline: string, content: string) => computePlanDiff(
  baseline.endsWith('\n') ? baseline : baseline + '\n',
  content.endsWith('\n') ? content : content + '\n',
);

export type TextRange = { start: number; end: number };
export type HighlightInput = { tokens: readonly InlineDiffToken[]; rendered: string };
export type HighlightProjector = (inputs: HighlightInput[]) => Promise<TextRange[][]>;

/** Project added source characters onto rendered text, skipping Markdown syntax. */
export function addedTextRanges(tokens: readonly InlineDiffToken[], rendered: string): TextRange[] {
  let source = '';
  const added: TextRange[] = [];
  for (const token of tokens) {
    if (token.type === 'removed') continue;
    if (token.type === 'added') added.push({ start: source.length, end: source.length + token.value.length });
    source += token.value;
  }
  // ponytail: large/expensive prose keeps block paint; bound the finer comparison.
  if (source.length > 20_000 || rendered.length > 20_000) return [];
  const changes = diffChars(source, rendered, { timeout: 20 });
  if (!changes) return [];
  let sourceOffset = 0, renderedOffset = 0;
  const ranges: TextRange[] = [];
  for (const change of changes) {
    if (!change.added && !change.removed) {
      for (const range of added) {
        const start = Math.max(sourceOffset, range.start), end = Math.min(sourceOffset + change.value.length, range.end);
        if (end > start) ranges.push({ start: renderedOffset + start - sourceOffset, end: renderedOffset + end - sourceOffset });
      }
    }
    if (!change.added) sourceOffset += change.value.length;
    if (!change.removed) renderedOffset += change.value.length;
  }
  return ranges;
}

/** Native range paint leaves the text and element tree untouched for annotation anchors. */
export function useDocumentChanges(
  containerRef: RefObject<HTMLElement | null>, blocks: readonly Block[], changes?: readonly PlanDiffBlock[], project?: HighlightProjector,
) {
  const name = `pn-document-added-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !changes) return;
    const metadata = new Map<string, { type: 'added' | 'modified'; tokens?: InlineDiffToken[] }>();
    const changed = changes.filter(change => change.type !== 'unchanged' && change.newStart !== undefined);
    let cursor = 0;
    blocks.forEach((block, index) => {
      const end = (blocks[index + 1]?.startLine ?? Infinity) - 1;
      while (cursor < changed.length && changed[cursor].newEnd! < block.startLine) cursor++;
      const matching: PlanDiffBlock[] = [];
      for (let next = cursor; next < changed.length && changed[next].newStart! <= end; next++) matching.push(changed[next]);
      if (!matching.length) return;
      const type = matching.every(change => change.type === 'added') ? 'added' : 'modified';
      const tokens = matching.length === 1 ? matching[0].inlineTokens : undefined;
      // Word offsets apply only to a whole, single prose block. Structural edits
      // (tables, fences, multi-block chunks) retain the block-level indication.
      const fullText = tokens?.filter(token => token.type !== 'removed').map(token => token.value).join('');
      metadata.set(block.id, { type, tokens: fullText === block.content ? tokens : undefined });
    });
    const api = globalThis as unknown as {
      CSS?: { highlights?: Map<string, unknown> };
      Highlight?: new (...ranges: Range[]) => unknown;
    };
    const registry = api.CSS?.highlights;
    const style = document.createElement('style');
    style.textContent = `::highlight(${name}) { background-color:color-mix(in srgb, #45b87b 35%, transparent); text-decoration:underline #45b87b; }`;
    if (registry && api.Highlight) document.head.appendChild(style);
    const decorated = new Set<HTMLElement>();
    function clear() {
      decorated.forEach(element => element.removeAttribute('data-document-change'));
      decorated.clear(); registry?.delete(name);
    }
    let sequence = 0, disposed = false;
    function paint() {
      const current = ++sequence;
      clear();
      const inputs: HighlightInput[] = [];
      const nodeGroups: { node: Text; start: number; end: number }[][] = [];
      container!.querySelectorAll<HTMLElement>('[data-block-id]').forEach(element => {
        const change = metadata.get(element.dataset.blockId!);
        if (!change) return;
        element.dataset.documentChange = change.type; decorated.add(element);
        if (!registry || !api.Highlight || !change.tokens) return;
        const nodes: { node: Text; start: number; end: number }[] = [];
        let text = '';
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node.parentElement?.closest('.annotation-exclude, svg, button, style, script')) continue;
          const value = node.textContent ?? '';
          nodes.push({ node: node as Text, start: text.length, end: text.length + value.length });
          text += value;
        }
        inputs.push({ tokens: change.tokens, rendered: text });
        nodeGroups.push(nodes);
      });
      function apply(projected: TextRange[][]) {
        if (disposed || current !== sequence || !registry || !api.Highlight) return;
        const ranges: Range[] = [];
        projected.forEach((offsets, index) => {
          const nodes = nodeGroups[index];
          if (!nodes) return;
          for (const offset of offsets) {
            const start = nodes.find(entry => entry.end > offset.start);
            const end = nodes.find(entry => entry.end >= offset.end && entry.start < offset.end);
            if (!start || !end) continue;
            const range = document.createRange();
            range.setStart(start.node, offset.start - start.start); range.setEnd(end.node, offset.end - end.start);
            ranges.push(range);
          }
        });
        registry.set(name, new api.Highlight(...ranges));
      }
      if (project && inputs.length) void project(inputs).then(apply).catch(() => apply([]));
      else apply(inputs.map(input => addedTextRanges(input.tokens, input.rendered)));
    }
    paint();
    // Annotation marks and lazy syntax/diagram renderers can replace text nodes.
    // Repaint after those mutations; attribute paint itself cannot retrigger it.
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; if (!disposed) paint(); });
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => { disposed = true; observer.disconnect(); clear(); style.remove(); };
  }, [containerRef, blocks, changes, name, project]);
}
