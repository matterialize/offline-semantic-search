import { expect, it } from 'vitest';
import { adaptiveResults, rankResults } from '../../src/search/ranking';
import type { Passage, SearchResult, Snapshot } from '../../src/types';
const passage = (id: string, text: string, extra: Partial<Passage> = {}): Passage => ({ id, text, order: Number(id), kind: 'sentence', role: 'body', contextGroup: 'article', before: '', after: '', ...extra });
const score = (id: string, value: number): SearchResult => ({ passageId: id, score: value, start: 0, end: 20 });

it('uses matching headings to boost body text while retaining raw heading diagnostics', () => {
 const passages = [passage('0', 'Transportation', { kind: 'heading' }), passage('1', 'Regular bus and train routes connect the towns.', { sectionHeadingIds: ['0'] }), passage('2', 'Transportation', { role: 'navigation' }), passage('3', 'Transportation', { role: 'control' }), passage('4', 'Transportation', { role: 'fragment' })];
 const ranked = rankResults('transportation', passages, [score('0', .8), score('1', .5), score('2', 1), score('3', 1), score('4', 1)]);
 expect(ranked.map(r => r.passageId)).toEqual(['1', '2', '3', '4', '0']);
 expect(ranked[0].score).toBe(.5); // Preserve raw cosine for diagnostics.
 expect(ranked[0].ranking?.sectionBoost).toBeCloseTo(.096);
});

it('does not promote unrelated body text solely because it is under a matching heading', () => {
 const passages = [passage('0', 'Transportation', { kind: 'heading' }), passage('1', 'The café sells fresh pastries.', { sectionHeadingIds: ['0'] })];
 const ranked = rankResults('transportation', passages, [score('0', 1), score('1', .1)]);
 expect(ranked.find(r => r.passageId === '1')!.evidenceScore).toBe(.1);
 expect(ranked.find(r => r.passageId === '1')!.ranking?.tier).toBe(4);
});

it('uses the paragraph when combined meaning wins, but retains sentences when one is substantially stronger', () => {
 const passages = [passage('0', 'The bus connects the towns.', { blockId: 'block' }), passage('1', 'Trains run every half hour.', { blockId: 'block' })];
 const snapshot: Snapshot = { id: 1, passages, coverageNote: '', blocks: [{ id: 'block', text: passages.map(p => p.text).join(' '), passageIds: ['0', '1'] }] };
 const grouped = adaptiveResults('transportation', snapshot, rankResults('transportation', passages, [score('0', .5), score('1', .55)]), new Map([['block', .6]]));
 expect(grouped).toHaveLength(1);
 expect(grouped[0].paragraph?.focus.passageId).toBe('1');
 expect(grouped[0].score).toBe(.6);
 const focused = adaptiveResults('transportation', snapshot, rankResults('transportation', passages, [score('0', .9), score('1', .3)]), new Map([['block', .5]]));
 expect(focused).toHaveLength(2);
 expect(focused.every(r => !r.paragraph)).toBe(true);
 expect(focused[0].passageId).toBe('0');
});

it('never merges sentences across paragraph boundaries or groups headings and controls', () => {
 const passages = [passage('0', 'Transportation', { kind: 'heading', blockId: 'h' }), passage('1', 'A bus stop is nearby.', { blockId: 'one' }), passage('2', 'A train station is nearby.', { blockId: 'two' })];
 const snapshot: Snapshot = { id: 1, passages, coverageNote: '', blocks: [{ id: 'h', text: 'Transportation', passageIds: ['0'] }, { id: 'one', text: passages[1].text, passageIds: ['1'] }, { id: 'two', text: passages[2].text, passageIds: ['2'] }] };
 expect(adaptiveResults('transportation', snapshot, rankResults('transportation', passages, [score('0', 1), score('1', .6), score('2', .7)]), new Map())).toHaveLength(2);
});


it('does not let a single-word outlier defeat a coherent paragraph', () => {
 const passages = [passage('0', 'Transportation.', { blockId: 'b', role: 'fragment' }), passage('1', 'Buses and trains connect our local communities.', { blockId: 'b' })];
 const snapshot: Snapshot = { id: 1, passages, coverageNote: '', blocks: [{ id: 'b', text: passages.map(p => p.text).join(' '), passageIds: ['0','1'] }] };
 const rows = adaptiveResults('transportation', snapshot, rankResults('transportation', passages, [score('0', 1), score('1', .6)]), new Map([['b', .65]]));
 expect(rows).toHaveLength(1);
 expect(rows[0].paragraph?.focus.passageId).toBe('1');
});

it('matching heading support can qualify a paragraph and its sentences, without helping another section', () => {
 const passages = [passage('0', 'Accessibility', { kind: 'heading' }), passage('1', 'Use the east entrance.', { blockId: 'b', sectionHeadingIds: ['0'] }), passage('2', 'The ramp is beside the door.', { blockId: 'b', sectionHeadingIds: ['0'] }), passage('3', 'Our café sells pastries.', { sectionHeadingIds: [] })];
 const snapshot: Snapshot = { id: 1, passages, coverageNote: '', blocks: [{ id: 'b', text: 'Use the east entrance. The ramp is beside the door.', passageIds: ['1', '2'] }] };
 const ranked = rankResults('accessibility', passages, [score('0', .9), score('1', .25), score('2', .25), score('3', .25)], new Map([['b', .25]]));
 const rows = adaptiveResults('accessibility', snapshot, ranked, new Map([['b', .25]]));
 expect(rows.some(row => row.passageId === '0')).toBe(false);
 expect(rows.find(row => row.paragraph)?.evidenceScore).toBeCloseTo(.358);
 expect(ranked.find(row => row.passageId === '1')?.evidenceScore).toBeCloseTo(.358);
 expect(ranked.find(row => row.passageId === '3')?.evidenceScore).toBe(.25);
});


it('retains an exact sentence query when section context closes the paragraph score gap', () => {
 const passages = [passage('0', 'The tram stops beside the railway station.', { blockId: 'block' }), passage('1', 'Our café sells pastries and coffee.', { blockId: 'block' })];
 const snapshot: Snapshot = { id: 1, passages, coverageNote: '', blocks: [{ id: 'block', text: passages.map(p => p.text).join(' '), passageIds: ['0', '1'] }] };
 const query = passages[0].text;
 const rows = adaptiveResults(query, snapshot, rankResults(query, passages, [score('0', .6), score('1', .4)]), new Map([['block', .55]]));
 expect(rows[0].passageId).toBe('0');
 expect(rows.every(row => !row.paragraph)).toBe(true);
});
