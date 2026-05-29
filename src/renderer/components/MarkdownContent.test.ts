import { expect, test } from 'vitest';

import {
  getLargeMarkdownPreview,
  shouldUseLargeMarkdownPreview,
} from './MarkdownContent';

test('large markdown preview threshold only applies to oversized content', () => {
  expect(shouldUseLargeMarkdownPreview('x'.repeat(30 * 1024))).toBe(false);
  expect(shouldUseLargeMarkdownPreview('x'.repeat(30 * 1024 + 1))).toBe(true);
});

test('large markdown preview keeps the head and latest tail', () => {
  const content = `head-${'x'.repeat(8 * 1024)}-middle-${'y'.repeat(8 * 1024)}-tail`;
  const preview = getLargeMarkdownPreview(content);

  expect(preview.startsWith('head-')).toBe(true);
  expect(preview).toContain('\n...\n');
  expect(preview.endsWith('-tail')).toBe(true);
  expect(preview.length).toBeLessThan(content.length);
});
