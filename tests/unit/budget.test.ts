import { describe, expect, it } from 'vitest';
import { aggregateQueryScores, windows } from '../../src/search/budget';
import { tokenOffsets } from '../../src/search/token-offsets';

describe('token windows', () => {
  it('covers long text with overlap and retains its final token', () => {
    const tokens = Array.from({ length: 1000 }, (_, i) => i);
    const parts = [...windows(tokens, 254, 32)];
    expect(parts[1].start).toBe(222);
    expect(parts.at(-1)?.end).toBe(1000);
    expect(new Set(parts.flatMap((part) => part.tokens)).size).toBe(1000);
    expect(aggregateQueryScores([0.8, 0.2, -0.4])).toBeCloseTo(0.2);
  });
});

describe('original text offsets', () => {
  it('maps accents, WordPiece suffixes, punctuation and UTF-16', () => {
    const text = 'Café unboxing, hello!';
    const offsets = tokenOffsets(text, ['cafe', 'un', '##box', '##ing', ',', 'hello', '!']);
    expect(offsets.map(({ start, end }) => text.slice(start, end))).toEqual(['Café', 'un', 'box', 'ing', ',', 'hello', '!']);
    const emoji = tokenOffsets('Hello 🦊 world', ['hello', '[UNK]', 'world']);
    expect(emoji.map(({ start, end }) => 'Hello 🦊 world'.slice(start, end))).toEqual(['Hello', '🦊', 'world']);
  });
});
