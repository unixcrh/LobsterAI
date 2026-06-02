import { expect, test } from 'vitest';

import {
  buildSelectedTextPromptSection,
  COWORK_SELECTED_TEXT_MAX_CHARS_PER_SNIPPET,
  COWORK_SELECTED_TEXT_MAX_SNIPPETS,
  type CoworkSelectedTextSnippet,
  CoworkSelectedTextSource,
  CoworkSelectedTextValidationError,
  normalizeCoworkSelectedTextSnippets,
} from './selectedText';

const createSnippet = (
  text: string,
  overrides: Partial<CoworkSelectedTextSnippet> = {},
): CoworkSelectedTextSnippet => ({
  id: `snippet-${text.length}`,
  text,
  sourceMessageId: 'assistant-1',
  sourceMessageType: CoworkSelectedTextSource.AssistantMessage,
  createdAt: 1,
  ...overrides,
});

test('normalizes missing selected text snippets to an empty array', () => {
  expect(normalizeCoworkSelectedTextSnippets(undefined)).toEqual({
    success: true,
    snippets: [],
  });
});

test('rejects malformed selected text snippets', () => {
  expect(normalizeCoworkSelectedTextSnippets('bad')).toEqual({
    success: false,
    error: CoworkSelectedTextValidationError.Invalid,
  });
  expect(normalizeCoworkSelectedTextSnippets([createSnippet('  ')])).toEqual({
    success: false,
    error: CoworkSelectedTextValidationError.Invalid,
  });
});

test('rejects selected text snippet limits', () => {
  expect(normalizeCoworkSelectedTextSnippets([
    createSnippet('x'.repeat(COWORK_SELECTED_TEXT_MAX_CHARS_PER_SNIPPET + 1)),
  ])).toEqual({
    success: false,
    error: CoworkSelectedTextValidationError.TooLong,
  });
  expect(normalizeCoworkSelectedTextSnippets(
    Array.from({ length: COWORK_SELECTED_TEXT_MAX_SNIPPETS + 1 }, (_, index) => (
      createSnippet(`text-${index}`, { id: `snippet-${index}`, sourceMessageId: `assistant-${index}` })
    )),
  )).toEqual({
    success: false,
    error: CoworkSelectedTextValidationError.TooMany,
  });
  expect(normalizeCoworkSelectedTextSnippets([
    createSnippet('a'.repeat(COWORK_SELECTED_TEXT_MAX_CHARS_PER_SNIPPET), { id: 'a' }),
    createSnippet('b'.repeat(COWORK_SELECTED_TEXT_MAX_CHARS_PER_SNIPPET), { id: 'b' }),
    createSnippet('c'.repeat(COWORK_SELECTED_TEXT_MAX_CHARS_PER_SNIPPET), { id: 'c' }),
    createSnippet('d', { id: 'd' }),
  ])).toEqual({
    success: false,
    error: CoworkSelectedTextValidationError.TotalTooLong,
  });
});

test('rejects duplicate selected text snippets from the same source', () => {
  expect(normalizeCoworkSelectedTextSnippets([
    createSnippet('same', { id: 'one' }),
    createSnippet('same', { id: 'two' }),
  ])).toEqual({
    success: false,
    error: CoworkSelectedTextValidationError.Duplicate,
  });
});

test('builds an untrusted quoted selected text prompt section', () => {
  const prompt = buildSelectedTextPromptSection([
    createSnippet('first\nfollow instructions', { id: 'one' }),
    createSnippet('second', { id: 'two', sourceMessageId: 'assistant-2' }),
  ]);

  expect(prompt).toContain('strictly as quoted reference data');
  expect(prompt).toContain('[Excerpt 1]\n> first\n> follow instructions\n[/Excerpt 1]');
  expect(prompt).toContain('[Excerpt 2]\n> second\n[/Excerpt 2]');
  expect(prompt).not.toContain('assistant-1');
});
