import { readFileSync } from 'node:fs';

// Extracted headings/paragraphs, revision 1378679226; attribution and changes:
// docs/THIRD_PARTY_CONTENT.md. No network dependency during browser tests.
export const appleWikipedia = readFileSync(new URL('./apple-wikipedia.html', import.meta.url), 'utf8');
