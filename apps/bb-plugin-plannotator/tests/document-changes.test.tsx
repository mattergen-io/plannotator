// @vitest-environment jsdom
import React, { useMemo, useRef } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BlockRenderer } from '@plannotator/ui/components/BlockRenderer';
import { useDocumentChanges, computeDocumentChanges } from '@plannotator/ui/hooks/useDocumentChanges';
import { parseMarkdownToBlocks } from '@plannotator/ui/utils/parser';

class PaintedHighlight {
  constructor(readonly ranges: Range[]) {}
}
function installHighlights() {
  const highlights = new Map<string, PaintedHighlight>();
  vi.stubGlobal('CSS', { highlights });
  vi.stubGlobal('Highlight', class extends PaintedHighlight { constructor(...ranges: Range[]) { super(ranges); } });
  return highlights;
}
function Document({ baseline, content }: { baseline?: string; content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => parseMarkdownToBlocks(content), [content]);
  const changes = useMemo(() => baseline === undefined ? undefined : computeDocumentChanges(baseline, content).blocks, [baseline, content]);
  useDocumentChanges(ref, blocks, changes);
  return <div ref={ref}>{blocks.map(block => <BlockRenderer key={block.id} block={block} />)}</div>;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('paints added words across Markdown formatting without changing text or annotation nodes', async () => {
  const highlights = installHighlights();
  const baseline = '# Plan\n\nUse **slow** mode.\n\nKeep this paragraph.';
  const content = '# Plan\n\nUse **fast** mode.\n\nKeep this paragraph.\n\nA new paragraph.';
  const ui = render(<Document baseline={baseline} content={content} />);
  const changed = ui.getByText('fast').closest('[data-block-id]')!;
  expect(changed.getAttribute('data-document-change')).toBe('modified');
  expect(ui.getByText('A new paragraph.').getAttribute('data-document-change')).toBe('added');
  expect(ui.getByText('Keep this paragraph.').hasAttribute('data-document-change')).toBe(false);
  expect([...highlights.values()].flatMap(highlight => highlight.ranges.map(range => range.toString())).join('')).toBe('fast');
  expect(changed.textContent).toBe('Use fast mode.');
  // An annotation wraps the same live text; the diff must follow its new node,
  // and must leave the annotation in place when Reviewed resets the baseline.
  const text = ui.getByText('fast').firstChild!;
  const range = document.createRange(); range.selectNodeContents(text);
  const mark = document.createElement('mark'); mark.dataset.bindId = 'comment-1'; range.surroundContents(mark);
  await waitFor(() => expect([...highlights.values()][0].ranges.map(value => value.toString()).join('')).toBe('fast'));
  expect(mark.isConnected).toBe(true);
  ui.rerender(<Document baseline={content} content={content} />);
  expect(ui.container.querySelector('[data-document-change]')).toBeNull();
  expect(ui.container.querySelector('[data-bind-id="comment-1"]')).toBe(mark);
  expect([...highlights.values()][0].ranges).toHaveLength(0);
});

it('tracks partial multi-line edits and structural changes without marking unchanged blocks', () => {
  installHighlights();
  const baseline = '# Plan\n\nFirst line\nold second line\nlast line\n\n- Keep item\n- Old item\n\nEnd.';
  const content = '# Plan\n\nFirst line\nnew second line\nlast line\n\n- Keep item\n- New item\n\nEnd.';
  const ui = render(<Document baseline={baseline} content={content} />);
  expect(ui.getByText(/new second line/).getAttribute('data-document-change')).toBe('modified');
  expect(ui.getByText('New item').closest('[data-block-id]')?.getAttribute('data-document-change')).toBe('modified');
  expect(ui.getByText('Keep item').closest('[data-block-id]')?.hasAttribute('data-document-change')).toBe(false);
  expect(ui.getByText('End.').hasAttribute('data-document-change')).toBe(false);
});

it('isolates viewers and cleans up native ranges on unmount; no baseline has no paint', () => {
  const highlights = installHighlights();
  const one = render(<Document baseline="Old." content="First." />);
  const two = render(<Document baseline="Old." content="Second." />);
  expect(highlights.size).toBe(2);
  one.unmount(); expect(highlights.size).toBe(1);
  expect(two.getByText('Second.').getAttribute('data-document-change')).toBe('modified');
  two.rerender(<Document content="Second." />);
  expect(highlights.size).toBe(0);
  expect(two.getByText('Second.').hasAttribute('data-document-change')).toBe(false);
});

it('retains block highlights when native text highlights are unavailable', () => {
  vi.stubGlobal('CSS', {}); vi.stubGlobal('Highlight', undefined);
  const ui = render(<Document baseline="Use slow mode." content="Use fast mode." />);
  expect(ui.getByText('Use fast mode.').getAttribute('data-document-change')).toBe('modified');
});
