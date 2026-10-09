import { expect, it } from 'vitest';
import { finalizeRetrieved, lexicalScores } from '../../src/search/hybrid';
import { rankResults } from '../../src/search/ranking';
import type { Passage, SearchResult, Snapshot } from '../../src/types';

function fixture(texts: string[], values = texts.map(() => .5)) {
  const passages: Passage[] = texts.map((text, index) => ({ id: String(index), text, order: index, kind: 'sentence', role: 'body', contextGroup: 'main', before: '', after: '' }));
  const scores: SearchResult[] = passages.map((passage, index) => ({ passageId: passage.id, score: values[index], start: 0, end: passage.text.length }));
  const snapshot: Snapshot = { id: 1, passages, coverageNote: '' };
  const get = (query: string) => finalizeRetrieved(query, snapshot, rankResults(query, passages, scores), new Map());
  return { snapshot, scores, get };
}

it('normalizes miles/mile and rewards exact phrases without matching unrelated numbers or stopwords', () => {
  expect(lexicalScores('How many miles?', ['20', 'A mile away.', 'The road covers 20 miles.'])[0]).toBe(0);
  expect(lexicalScores('How many miles?', ['20', 'A mile away.', 'The road covers 20 miles.']).slice(1).every((score) => score > 0)).toBe(true);
  const scores = lexicalScores('public transportation', ['Public transportation', 'Transportation available to the public']);
  expect(scores[0]).toBeGreaterThan(scores[1]);
  expect(lexicalScores('the and', ['the and'])).toEqual([0]);
});

it('suppresses standalone numbers unless explicitly queried while retaining explicit units', () => {
  const { get } = fixture(['20', '6', '36', '20 miles', '20%', '$20', '1,234.5']);
  expect(get('How many miles?').map((row) => row.passageId)).toEqual(['3', '4', '5']);
  expect(get('20').some((row) => row.passageId === '0')).toBe(true);
  expect(get('20').some((row) => row.passageId === '1')).toBe(false);
});

it('preserves every qualified passage beyond the former reranking candidate limit', () => {
  const { get } = fixture(Array.from({ length: 75 }, (_, i) => `Passage about buses ${i}.`));
  expect(get('buses')).toHaveLength(75);
});

it('literal ordering cannot rescue a passage below the LEAF cutoff or rewrite cosine', () => {
  const { get } = fixture(['bus routes', 'Regular buses connect the towns.', 'bus routes'], [.05, .5, .5]);
  const rows = get('bus routes');
  expect(rows.map((row) => row.passageId)).toEqual(['2', '1']);
  expect(rows[0].score).toBe(.5);
});

it('headings never become results for either questions or keyword queries', () => {
  const { snapshot, scores } = fixture(['Harbor Museum', 'Harbor Museum is in Westfield.'], [.6, .8]);
  snapshot.passages[0].kind = 'heading';
  const get = (query: string) => finalizeRetrieved(query, snapshot, rankResults(query, snapshot.passages, scores), new Map());
  expect(get('Where is Harbor Museum?').map((row) => row.passageId)).toEqual(['1']);
  expect(get('Harbor Museum').map((row) => row.passageId)).toEqual(['1']);
});


it('checks question intent independently of title similarity and retains related paragraph context', () => {
  const { snapshot, scores } = fixture(['The attraction is in three parks.', 'Its versions opened in Florida, California and Japan.', 'The attraction has a video game.', 'Article about the attraction.', 'Park navigation'], [.67, .45, .7, .8, .9]);
  snapshot.passages[3].role = 'reference';
  snapshot.passages[4].role = 'navigation';
  const ranked = rankResults('Which park is Example Attraction in?', snapshot.passages, scores);
  const question = { sentences: new Map([['0', .4], ['1', .29], ['2', .12], ['3', .7], ['4', .9]]), paragraphs: new Map<string, number>() };
  const rows = finalizeRetrieved('Which park is Example Attraction in?', snapshot, ranked, new Map(), question);
  expect(rows.map((row) => row.passageId)).toEqual(['0', '1']);
  expect(rows[0].score).toBe(.67);
  expect(rows[0].questionScore).toBe(.4);
  // The structural exclusions also apply to keyword retrieval.
  expect(finalizeRetrieved('attraction', snapshot, ranked, new Map()).map((row) => row.passageId)).toEqual(['2', '0', '1']);
});


it('restores an answering sentence when its grouped paragraph fails question intent', () => {
  const { snapshot, scores } = fixture(['The museum is in Westfield.', 'The museum gift shop sells postcards.'], [.6, .6]);
  snapshot.passages.forEach((p) => p.blockId = 'block');
  snapshot.blocks = [{ id: 'block', text: snapshot.passages.map((p) => p.text).join(' '), passageIds: ['0', '1'] }];
  const paragraphs = new Map([['block', .6]]);
  const question = { sentences: new Map([['0', .5], ['1', .1]]), paragraphs: new Map([['block', .1]]) };
  const rows = finalizeRetrieved('Where is the museum?', snapshot, rankResults('Where is the museum?', snapshot.passages, scores, paragraphs), paragraphs, question);
  expect(rows.map((row) => row.passageId)).toEqual(['0']);
  expect(rows[0].paragraph).toBeUndefined();
});
