import { readFile } from 'node:fs/promises';
import { BertTokenizer } from '@huggingface/transformers';
import { expect, it } from 'vitest';
import { MODEL, QUERY_PREFIX, embeddingWindows } from '../../src/search/embedding';

it('manual model inputs match the actual pinned BERT tokenizer single-text encoding', async () => {
  const root = new URL(`../../public/models/${MODEL}/`, import.meta.url);
  const tokenizer = new BertTokenizer(
    JSON.parse(await readFile(new URL('tokenizer.json', root), 'utf8')),
    JSON.parse(await readFile(new URL('tokenizer_config.json', root), 'utf8')),
  );
  const passage = 'Show the QR code on your phone.';
  const [part] = embeddingWindows(tokenizer.encode(passage, { add_special_tokens: false }));
  expect([101, ...part.tokens, 102]).toEqual(tokenizer.encode(passage));
});

it('reserves the LEAF query prefix in every window without losing query tokens', async () => {
  const root = new URL(`../../public/models/${MODEL}/`, import.meta.url);
  const tokenizer = new BertTokenizer(
    JSON.parse(await readFile(new URL('tokenizer.json', root), 'utf8')),
    JSON.parse(await readFile(new URL('tokenizer_config.json', root), 'utf8')),
  );
  const prefix = tokenizer.encode(QUERY_PREFIX, { add_special_tokens: false });
  const short = 'Where can I return my package?';
  const tokens = tokenizer.encode(short, { add_special_tokens: false });
  expect([101, ...prefix, ...tokens, 102]).toEqual(tokenizer.encode(QUERY_PREFIX + short));
  const long = tokenizer.encode('connection pooling '.repeat(600), { add_special_tokens: false });
  const parts = embeddingWindows(long, prefix.length);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.every((part) => part.tokens.length + prefix.length + 2 <= 512)).toBe(true);
  expect(parts.at(-1)?.end).toBe(long.length);
  expect(parts[1].start).toBe(parts[0].end - 32);
});
