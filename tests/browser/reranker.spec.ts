// Wikipedia excerpt licensing and attribution: docs/THIRD_PARTY_CONTENT.md.
import { expect, test, type Page } from '@playwright/test';
import { appleWikipedia } from '../fixtures/apple-wikipedia';
const panel = (page: Page) => page.frameLocator('[data-semantic-find="panel"] iframe');
const dev = (page: Page) => panel(page).locator('body');
async function search(page: Page, query: string) {
  await panel(page).getByRole('searchbox').fill(query);
  await expect.poll(() => dev(page).evaluate(() => (window as any).semanticFindDev.metrics()?.effectiveQuery), { timeout: 90000 }).toBe(query);
}

test('shows the strongest answers and filters weak tails on fresh and cached searches', async ({ page }) => {
  await page.goto('/demo.html');
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  for (const query of ['When will I receive my refund?', 'How can I send it back without a printer?', 'When will I receive my refund?']) {
    await search(page, query);
    const data = await dev(page).evaluate(() => ({ rows: (window as any).semanticFindDev.results(),
      candidates: (window as any).semanticFindDev.candidates() }));
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].text).toContain(query.includes('refund') ? 'five business days' : 'QR code');
    expect(data.candidates.length).toBeGreaterThan(data.rows.length);
    await expect(panel(page).locator('#position')).toHaveText('1 of 1');
  }
});

for (const backend of ['auto', 'wasm'] as const)
test(`LEAF retrieves and Ettin reranks Apple Wikipedia with a LEAF-only comparison (${backend})`, async ({ page }, info) => {
  await page.goto('/demo.html');
  await page.evaluate((html) => { document.querySelector('main.guide')!.innerHTML = html; }, appleWikipedia);
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await dev(page).evaluate((_node, mode) => (window as any).semanticFindDev.setBackend(mode), backend);
  await search(page, 'Who founded Apple?');
  const ettin = await dev(page).evaluate(() => ({ rows: (window as any).semanticFindDev.results(), metrics: (window as any).semanticFindDev.metrics() }));
  expect(ettin.metrics.rerankPairs).toBeGreaterThan(0);
  expect(ettin.rows[0].text).toContain('Steve Wozniak');
  expect(ettin.rows[0].text).toContain('Ronald Wayne');
  expect(ettin.rows.every((row: any) => Number.isFinite(row.rerankScore))).toBe(true);
  await dev(page).evaluate(() => (window as any).semanticFindDev.setReranker(false));
  await expect.poll(() => dev(page).evaluate(() => (window as any).semanticFindDev.metrics()?.reranker)).toBeUndefined();
  await expect(panel(page).locator('#status')).toHaveText('Closest matches');
  const leaf = await dev(page).evaluate(() => ({ rows: (window as any).semanticFindDev.results(), metrics: (window as any).semanticFindDev.metrics() }));
  expect(leaf.metrics.rerankPairs).toBeUndefined();
  expect(leaf.rows.every((row: any) => row.rerankScore === undefined)).toBe(true);
  await info.attach('leaf-ettin-apple-comparison', { body: JSON.stringify({ ettin, leaf }), contentType: 'application/json' });
});

test('uses local section headings, caches pairs and retains body-only highlights', async ({ page }) => {
  await page.goto('/demo.html');
  await page.evaluate(() => {
    document.querySelector('main.guide')!.innerHTML = '<h1>Attraction guide</h1><h2>Former games</h2><p>The balloon game uses darts to hit the targets. Players earn points for each balloon.</p><h2>Current games</h2><p>The balloon game uses darts to hit the targets. Players earn points for each balloon.</p>';
  });
  const snapshot = await page.evaluate(() => (window as any).semanticFindDemo.extract());
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await search(page, 'former games');
  const rows = await dev(page).evaluate(() => (window as any).semanticFindDev.results());
  const bodies = snapshot.passages.filter((p: any) => p.text.startsWith('The balloon'));
  expect(rows[0].paragraph.blockId).toBe(bodies[0].blockId);
  // The weaker current-games row may now be excluded by the display cutoff.
  if (rows.length > 1) expect(rows[0].rerankScore).toBeGreaterThan(rows[1].rerankScore);
  await expect(panel(page).locator('.result[data-kind="heading"]')).toHaveCount(0);
  expect(await page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-active')][0].toString())).not.toContain('Former games');
  // A DOM edit invalidates panel rankings, but unchanged pairs remain cached.
  await page.evaluate(() => document.querySelector('main.guide')!.append(Object.assign(document.createElement('p'), { textContent: 'Visitors can buy snacks near the entrance.' })));
  await expect.poll(() => dev(page).evaluate(() => (window as any).semanticFindDev.metrics()?.rerankCacheHits ?? 0)).toBeGreaterThan(0);
});

test('query changes during Ettin loading discard stale results', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route('**/models/cross-encoder/ettin-reranker-17m-v1/onnx/model*.onnx', async (route) => {
    requested = true; await gate; await route.continue();
  });
  await page.goto('/demo.html');
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await panel(page).getByRole('searchbox').fill('How can I send it back without a printer?');
  await expect.poll(() => requested, { timeout: 60000 }).toBe(true);
  await panel(page).getByRole('searchbox').fill('When will I receive my refund?');
  await panel(page).getByRole('searchbox').press('Enter');
  release();
  await expect(panel(page).locator('.result').first()).toContainText('five business days');
  const metrics = await dev(page).evaluate(() => (window as any).semanticFindDev.metrics());
  expect(metrics.effectiveQuery).toBe('When will I receive my refund?');
  expect(metrics.rerankPairs).toBeGreaterThan(0);
});

test('covers long passage tails and runs pairs beyond MiniLM context in browser WASM', async ({ page }, info) => {
  await page.goto('/demo.html');
  await page.evaluate(() => {
    const text = 'Visitors play interactive carnival games in this theme park attraction, '.repeat(100)
      + 'and the final game awards bonus points. The attraction is located in Tokyo DisneySea.';
    document.querySelector('main.guide')!.innerHTML = '<h2>Games</h2><p>' + text + '</p>';
  });
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await dev(page).evaluate(() => (window as any).semanticFindDev.setBackend('wasm'));
  await search(page, 'interactive carnival games');
  const windowed = await dev(page).evaluate(() => (window as any).semanticFindDev.metrics());
  expect(windowed.rerankLongestPair).toBe(1024);
  expect(windowed.rerankPairs).toBeGreaterThan(1);
  await dev(page).evaluate(() => (window as any).semanticFindDev.setContextTokens(7999));
  await expect.poll(() => dev(page).evaluate(() => (window as any).semanticFindDev.metrics()?.maxPairTokens), { timeout: 90000 }).toBe(7999);
  const extended = await dev(page).evaluate(() => ({ metrics: (window as any).semanticFindDev.metrics(), rows: (window as any).semanticFindDev.results() }));
  expect(extended.metrics.rerankLongestPair).toBeGreaterThan(1024);
  expect(extended.rows.every((row: any) => Number.isFinite(row.rerankScore))).toBe(true);
  expect(extended.rows.some((row: any) => row.text.includes('final game awards bonus points'))).toBe(true);
  await info.attach('long-context-wasm', { body: JSON.stringify({ windowed, extended: extended.metrics }), contentType: 'application/json' });
});
