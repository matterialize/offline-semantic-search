import { describe, expect, it } from 'vitest';
import { isRelevant, isRelevantResult, matchPercent, MIN_MATCH_PERCENT } from '../../src/search/relevance';
import { surroundingMatches } from '../../src/search/context';
import type { Passage, SearchResult } from '../../src/types';

function fixture(percentages: number[]) {
  const values = percentages.map((percent) => percent / 100);
  const passages: Passage[] = values.map((_, i) => ({
    id: String(i), order: i, text: `Sentence ${i}.`, kind: 'sentence', contextGroup: 'body', before: '', after: '',
  }));
  // Scores arrive in rank order, which must not determine text adjacency.
  const ranked: SearchResult[] = values.map((score, i) => ({ passageId: String(i), score, start: i, end: i + 10 })).sort((a, b) => b.score - a.score);
  const scores = new Map(ranked.map((result) => [result.passageId, result]));
  const surrounding = (index: number) => surroundingMatches(passages, scores, scores.get(String(index))!);
  return { passages, scores, surrounding };
}

describe('minimum match score', () => {
  it('uses an absolute cosine cutoff, including its boundary', () => {
    const boundary = MIN_MATCH_PERCENT / 100;
    expect(matchPercent(0)).toBe(0);
    expect(isRelevant(boundary - 0.001)).toBe(false);
    expect(isRelevant(boundary)).toBe(true);
    expect(isRelevant(boundary + 0.001)).toBe(true);
    expect(matchPercent(-1000)).toBe(0);
    expect(matchPercent(1000)).toBe(100);
  });
  it('can reject every scored sentence, including the best, and rejects invalid scores', () => {
    expect([-5, -7, -10].filter(isRelevant)).toEqual([]);
    expect([NaN, Infinity, -Infinity].some(isRelevant)).toBe(false);
  });
});

describe('surrounding sentence highlights', () => {
  it('extends both ways in page order through consecutive strong matches, preserving offsets', () => {
    const { surrounding, scores } = fixture([80, 90, 85, 79, 95]);
    expect(surrounding(1)).toEqual([scores.get('0'), scores.get('2')]);
  });
  it('stops at a weak sentence rather than reaching a stronger sentence beyond it', () => {
    const { surrounding } = fixture([90, 0.5, 75, 66, 55, 90]);
    expect(surrounding(2).map((result) => result.passageId)).toEqual(['3']);
    expect(surrounding(1)).toEqual([]);
  });
  it('never extends below the absolute cutoff when the selected score is low', () => {
    const { surrounding } = fixture([0.5, 35, 32, 0.9, 99]);
    expect(surrounding(1).map((result) => result.passageId)).toEqual(['2']);
  });
  it('does not cross headings or context groups, even when scores are high', () => {
    const { passages, surrounding } = fixture([80, 80, 80, 80, 80]);
    passages[1].kind = 'heading';
    passages[3].contextGroup = 'another-section-or-root';
    expect(surrounding(2)).toEqual([]);
    expect(surrounding(1)).toEqual([]);
  });
  it('stops at missing or invalid scores and handles a missing anchor', () => {
    const { passages, scores, surrounding } = fixture([80, 80, 80, 80, 80]);
    scores.delete('1');
    scores.get('3')!.score = NaN;
    expect(surrounding(2)).toEqual([]);
    expect(surroundingMatches(passages, scores, { passageId: 'missing', score: 8, start: 0, end: 10 })).toEqual([]);
  });
});

it('excludes unlabeled numbers from results and neighboring highlights despite high similarity', () => {
  expect(isRelevantResult({ score: .9, excludedReason: 'standalone number absent from query' })).toBe(false);
  const { scores, surrounding } = fixture([85, 90, 85]);
  scores.get('0')!.excludedReason = 'standalone number absent from query';
  expect(surrounding(1).map((row) => row.passageId)).toEqual(['2']);
});
