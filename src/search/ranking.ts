import type { Passage, SearchResult, Snapshot } from '../types';
import { isRelevant } from './relevance';

// Separate ranking rules from the semantic relevance cutoff. Scores remain
// cosine similarity; these heuristic bonuses are not confidence/probability.
export const RANKING_RULES = {
  strongSection: 0.5,
  minimumSectionEvidence: 0.2,
  maximumSectionBoost: 0.12,
  sentenceFocusMargin: 0.1,
  maximumParagraphBoost: 0.1,
  exactMatchBonus: 0.08,
} as const;

function words(text: string): string[] {
  return text.toLocaleLowerCase('en').normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
}

function exactPhrase(query: string[], text: string[]): boolean {
  if (!query.length || query.length > text.length) return false;
  return text.some((_, i) => query.every((word, j) => text[i + j] === word));
}

function rankPassage(queryWords: string[], passage: Passage, result: SearchResult,
  lookup: ReadonlyMap<string, SearchResult>, paragraphScores: ReadonlyMap<string, number>): SearchResult {
  const ownSimilarity = result.score;
  const exactMatch = exactPhrase(queryWords, words(passage.text));
  const paragraphSimilarity = passage.blockId ? paragraphScores.get(passage.blockId) ?? ownSimilarity : ownSimilarity;
  const sectionSimilarity = Math.max(0, ...(passage.sectionHeadingIds ?? []).map((id) => lookup.get(id)?.score ?? 0));
  const body = passage.role === 'body' || passage.role === undefined;
  const sectionBoost = body && passage.kind !== 'heading' && ownSimilarity >= RANKING_RULES.minimumSectionEvidence
    && sectionSimilarity >= RANKING_RULES.strongSection
    ? RANKING_RULES.maximumSectionBoost * sectionSimilarity : 0;
  // A matching section can help borderline body text, but never rescue text
  // with negligible relevance. Keep the boosted relevance bounded by 1.
  const paragraphBoost = body && passage.kind !== 'heading' && ownSimilarity >= RANKING_RULES.minimumSectionEvidence
    && paragraphSimilarity > ownSimilarity && isRelevant(paragraphSimilarity)
    ? Math.min(RANKING_RULES.maximumParagraphBoost, paragraphSimilarity - ownSimilarity) : 0;
  // Heading vectors support their section; they never qualify as results.
  const evidenceScore = passage.kind === 'heading' ? 0 : Math.min(1, ownSimilarity + sectionBoost + paragraphBoost);
  const qualified = isRelevant(evidenceScore);
  const tier = !qualified ? 4 : body ? 1 : passage.role === 'fragment' ? 3 : 2;
  const value = evidenceScore + (exactMatch && passage.kind !== 'heading' ? RANKING_RULES.exactMatchBonus : 0);
  const reason = passage.kind === 'heading' ? 'heading context only' : !qualified ? 'below cutoff'
    : body ? sectionBoost ? 'body text in matching section' : paragraphBoost ? 'body text in matching paragraph' : 'body text'
    : passage.role === 'navigation' ? 'navigation text' : passage.role === 'control' ? 'standalone control' : passage.role === 'reference' ? 'bibliography entry' : 'short fragment';
  return { ...result, evidenceScore, ranking: { paragraphSimilarity, paragraphBoost, tier, value, ownSimilarity, sectionSimilarity, sectionBoost, exactMatch, reason } };
}

export function rankResults(query: string, passages: Passage[], results: SearchResult[], paragraphScores: ReadonlyMap<string, number> = new Map()): SearchResult[] {
  const lookup = new Map(results.map((result) => [result.passageId, result]));
  const queryWords = words(query);
  return passages.map((passage) => rankPassage(queryWords, passage, lookup.get(passage.id)!, lookup, paragraphScores)).sort(compareRanking);
}


export function compareRanking(a: SearchResult, b: SearchResult): number {
  return (a.ranking?.tier ?? 1) - (b.ranking?.tier ?? 1)
    || (b.ranking?.value ?? b.score) - (a.ranking?.value ?? a.score);
}

/** Use a paragraph result unless an individual sentence is substantially better. */
export function adaptiveResults(query: string, snapshot: Snapshot, sentences: SearchResult[], paragraphScores: ReadonlyMap<string, number>, retrieveAllParagraphs = false): SearchResult[] {
  const scores = new Map(sentences.map((result) => [result.passageId, result]));
  const passages = new Map(snapshot.passages.map((passage) => [passage.id, passage]));
  const queryWords = words(query);
  const grouped = new Set<string>();
  const paragraphs: SearchResult[] = [];
  for (const block of snapshot.blocks ?? []) {
    const members = block.passageIds.map((id) => scores.get(id)!);
    if (members.length < 2 || members.some((member) => passages.get(member.passageId)?.kind === 'heading')) continue;
    const raw = paragraphScores.get(block.id);
    if (raw === undefined) continue;
    const representative = passages.get(members[0].passageId)!;
    if (representative.role === 'navigation' || representative.role === 'control' || representative.role === 'reference') continue;
    const substantive = members.filter((member) => {
      const role = passages.get(member.passageId)?.role;
      return role === 'body' || role === undefined;
    });
    if (!substantive.length) continue;
    // A one-word outlier must not defeat an otherwise coherent paragraph.
    const focus = substantive.reduce((best, member) => member.score > best.score ? member : best);
    const exactSentence = substantive.some((member) => {
      const textWords = words(passages.get(member.passageId)!.text);
      return textWords.length === queryWords.length && exactPhrase(queryWords, textWords);
    });
    if (!retrieveAllParagraphs && (exactSentence || focus.score - raw > RANKING_RULES.sentenceFocusMargin)) continue;
    const candidate: Passage = { ...representative, text: block.text, role: 'body' };
    const paragraph = rankPassage(queryWords, candidate,
      { passageId: representative.id, score: raw, start: 0, end: block.text.length }, scores, paragraphScores);
    if (!retrieveAllParagraphs && !isRelevant(paragraph.evidenceScore!)) continue;
    paragraph.paragraph = { blockId: block.id, text: block.text, passageIds: block.passageIds,
      focus: { passageId: focus.passageId, score: focus.score, start: focus.start, end: focus.end } };
    paragraphs.push(paragraph);
    for (const member of members) grouped.add(member.passageId);
  }
  // Explicit DOM-order tie-breaking survives replacement of sentence rows.
  return [...paragraphs, ...sentences.filter((result) => !grouped.has(result.passageId) && passages.get(result.passageId)?.kind !== 'heading')].sort((a, b) => compareRanking(a, b)
    || passages.get(a.passageId)!.order - passages.get(b.passageId)!.order);
}
