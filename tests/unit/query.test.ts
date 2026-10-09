import { expect, it } from 'vitest';
import { isQuestion } from '../../src/search/query';

it('distinguishes natural questions from keyword searches for structural ranking', () => {
  expect(isQuestion('Which park is this in?')).toBe(true);
  expect(isQuestion('Where is the entrance')).toBe(true);
  expect(isQuestion('Transportation')).toBe(false);
  expect(isQuestion('Whichford')).toBe(false);
});
