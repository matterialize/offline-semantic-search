import { expect, it } from 'vitest';
import { filterRerankedResults } from '../../src/search/reranker-filter';
import type { SearchResult } from '../../src/types';

const rows = (...scores: Array<number | undefined>): SearchResult[] => scores.map((rerankScore, index) =>
  ({ passageId: String(index), score: 0.5, start: 0, end: 10, rerankScore }));

it('keeps close alternatives and removes weak tails without changing ranking', () => {
  expect(filterRerankedResults(rows(8, 7, 6, 5.9, 3)).map((row) => row.rerankScore)).toEqual([8, 7, 6]);
});

it('returns no matches when all scores are weak, including a weak best match', () => {
  expect(filterRerankedResults(rows(3.9, 3, -1))).toEqual([]);
  expect(filterRerankedResults([])).toEqual([]);
});

it('applies the absolute floor and rejects missing or invalid scores', () => {
  expect(filterRerankedResults(rows(5, 4, 3.9, undefined, NaN, Infinity)).map((row) => row.rerankScore)).toEqual([5, 4]);
});
