import type { SearchResult, Snapshot } from '../types';
import { adaptiveResults, compareRanking } from './ranking';
import { isRelevantResult } from './relevance';

export const HYBRID_RULES = { maximumLexicalBoost: 0.04, minimumQuestionScore: 0.25, maximumQuestionDrop: 0.15, questionWeight: 0.75 } as const;
const invariantWords = new Set(['news', 'series', 'species']);
const stopWords = new Set('a an the and or of in on at to for from by with is are was were be been it its this that these those i you we they can could do does did how what which who where when why many much'.split(' '));
export function lexicalTokens(text: string): string[] {
  return (text.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => {
    if (invariantWords.has(word)) return word;
    if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.length > 4 && /(?:sses|shes|ches|xes|zes|uses)$/.test(word)) return word.slice(0, -2);
    return word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
  });
}

/** BM25 scores provide a bounded ordering boost, never a relevance probability. */
export function lexicalScores(query: string, texts: string[]): number[] {
  const phrase = lexicalTokens(query);
  const terms = [...new Set(phrase.filter((word) => !stopWords.has(word)))];
  if (!terms.length || !texts.length) return texts.map(() => 0);
  const documents = texts.map(lexicalTokens);
  const lengths = documents.map((tokens) => tokens.filter((word) => !stopWords.has(word)).length);
  const average = lengths.reduce((sum, length) => sum + length, 0) / documents.length || 1;
  const frequencies = documents.map((tokens) => {
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    return counts;
  });
  const idf = new Map(terms.map((term) => {
    const containing = frequencies.filter((counts) => counts.has(term)).length;
    return [term, Math.log(1 + (texts.length - containing + .5) / (containing + .5))];
  }));
  return documents.map((tokens, index) => {
    let score = 0;
    for (const term of terms) {
      const frequency = frequencies[index].get(term) ?? 0;
      score += idf.get(term)! * frequency * 2.2 / (frequency + 1.2 * (.25 + .75 * lengths[index] / average));
    }
    if (phrase.length && tokens.some((_, i) => phrase.every((word, j) => tokens[i + j] === word))) score += 2;
    return score;
  });
}

/** Unlabeled numbers must not become results or neighboring highlights. */
export function excludeStandaloneNumbers(query: string, text: string, result: SearchResult): SearchResult {
  const normalized = text.normalize('NFKC');
  const numericLiterals = (value: string) => value.match(/[+-]?\p{N}+(?:[.,]\p{N}+)*/gu) ?? [];
  const numbers = numericLiterals(normalized);
  const queryNumbers = new Set(numericLiterals(query.normalize('NFKC')));
  return numbers.length && /^[\p{N}\s.,+\-−–—()/:[\]]+$/u.test(normalized)
    && !numbers.every((number) => queryNumbers.has(number))
    ? { ...result, excludedReason: 'standalone number absent from query' } : result;
}

export interface QuestionEvidence {
  sentences: ReadonlyMap<string, number>;
  paragraphs: ReadonlyMap<string, number>;
}

/** LEAF determines acceptance; lexical matching nudges ordering within a tier. */
export function finalizeRetrieved(query: string, snapshot: Snapshot, ranked: SearchResult[], paragraphScores: ReadonlyMap<string, number>, question?: QuestionEvidence): SearchResult[] {
  const passageById = new Map(snapshot.passages.map((passage) => [passage.id, passage]));
  // General search policy: only substantive body text becomes a result row.
  let rows = adaptiveResults(query, snapshot, ranked, paragraphScores).filter((row) => {
    const role = passageById.get(row.passageId)!.role;
    return row.paragraph !== undefined || role === 'body' || role === undefined;
  });
  if (question) {
    // Resolve the subject without letting mentions of its title replace the
    // question's actual intent. Both vectors come from the same LEAF model.
    rows = rows.map((row) => ({ ...row, questionScore: row.paragraph
      ? question.paragraphs.get(row.paragraph.blockId) : question.sentences.get(row.passageId) }));
    const body = rows.filter((row) => {
      const role = passageById.get(row.passageId)!.role;
      return (row.paragraph !== undefined || role === 'body' || role === undefined) && isRelevantResult(row) && Number.isFinite(row.questionScore);
    });
    const best = Math.max(0, ...body.map((row) => row.questionScore!));
    const cutoff = Math.max(HYBRID_RULES.minimumQuestionScore, best - HYBRID_RULES.maximumQuestionDrop);
    const rejectedMembers = new Set(body.filter((row) => row.paragraph && row.questionScore! < cutoff)
      .flatMap((row) => row.paragraph!.passageIds));
    const fallback = ranked.filter((row) => rejectedMembers.has(row.passageId)).map((row) => ({
      ...row, questionScore: question.sentences.get(row.passageId),
    })).filter((row) => {
      const role = passageById.get(row.passageId)!.role;
      return (role === 'body' || role === undefined) && isRelevantResult(row);
    });
    // Rejecting a grouped paragraph must not also hide its answering sentence.
    rows = [...body, ...fallback].filter((row) => Number.isFinite(row.questionScore) && row.questionScore! >= cutoff).map((row) => ({ ...row,
      ranking: row.ranking ? { ...row.ranking, value: HYBRID_RULES.questionWeight * row.questionScore!
        + (1 - HYBRID_RULES.questionWeight) * row.ranking.value } : undefined,
    }));
  }
  const texts = rows.map((row) => row.paragraph?.text ?? passageById.get(row.passageId)!.text);
  const lexical = lexicalScores(query, texts);
  const maximum = Math.max(0, ...lexical);
  return rows.map((row, index) => ({ ...row, ranking: row.ranking ? { ...row.ranking,
    value: row.ranking.value + (maximum ? HYBRID_RULES.maximumLexicalBoost * lexical[index] / maximum : 0),
  } : undefined })).map((row, index) => excludeStandaloneNumbers(query, texts[index], row))
    .filter(isRelevantResult).sort((a, b) => compareRanking(a, b) || passageById.get(a.passageId)!.order - passageById.get(b.passageId)!.order);
}
