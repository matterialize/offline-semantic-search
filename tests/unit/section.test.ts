import { expect, it } from 'vitest';
import { sectionInput, sectionKey } from '../../src/search/section';
import type { Passage } from '../../src/types';
const p = (id: string, text: string, extra: Partial<Passage> = {}): Passage => ({ id, text, kind: 'sentence', role: 'body', order: 0, contextGroup: 'main', before: '', after: '', ...extra });

it('uses the closest local heading and keeps identical text in different sections separate', () => {
  const headings = [p('title', 'Apple Inc.', { kind: 'heading', headingLevel: 1 }), p('games', 'Games', { kind: 'heading', headingLevel: 2 }), p('former', 'Former games', { kind: 'heading', headingLevel: 3 }), p('current', 'Current games', { kind: 'heading', headingLevel: 3 })];
  const lookup = new Map(headings.map((item) => [item.id, item]));
  const text = 'The balloon game uses darts to hit the targets.';
  const former = sectionInput(p('a', text, { sectionHeadingIds: ['title', 'games', 'former'] }), lookup);
  const current = sectionInput(p('b', text, { sectionHeadingIds: ['title', 'games', 'current'] }), lookup);
  expect(former).toEqual({ section: 'Former games', text });
  expect(sectionKey(former)).not.toBe(sectionKey(current));
  expect(sectionInput(p('c', text, { sectionHeadingIds: ['title'] }), lookup).section).toBe('');
  expect(sectionInput(p('d', text), lookup).section).toBe('');
});

it('never attaches navigation headings or section context to standalone controls', () => {
  const heading = p('h', 'Navigation', { kind: 'heading', headingLevel: 2, role: 'navigation' });
  const lookup = new Map([['h', heading]]);
  expect(sectionInput(p('a', 'A paragraph describes the attraction.', { sectionHeadingIds: ['h'] }), lookup).section).toBe('');
  expect(sectionInput(p('b', 'Click this button', { role: 'control', sectionHeadingIds: ['h'] }), lookup).section).toBe('');
});
