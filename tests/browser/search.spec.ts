// Wikipedia excerpt licensing and attribution: docs/THIRD_PARTY_CONTENT.md.
import { expect, test, type Page } from '@playwright/test';
import { appleWikipedia } from '../fixtures/apple-wikipedia';

const frame = (page: Page) => page.frameLocator('[data-semantic-find="panel"] iframe');

for (const backend of ['auto', 'wasm'] as const)
test(`uses Apple Wikipedia context for a page-level question and excludes title rows (${backend})`, async ({ page }) => {
  await page.goto('/demo.html');
  await page.evaluate((html) => { document.querySelector('main.guide')!.innerHTML = html; }, appleWikipedia);
  const snapshot = await page.evaluate(() => (window as any).semanticFindDemo.extract());
  expect(snapshot.subject).toBe('Apple Inc.');
  await open(page);
  await frame(page).locator('body').evaluate((_node, mode) => (window as any).semanticFindDev.setBackend(mode), backend);
  await search(page, 'Where is this company headquartered?');
  const location = frame(page).locator('.result').filter({ hasText: 'Cupertino' }).first();
  await expect(location).toBeVisible();
  await expect(frame(page).locator('.result[data-kind="heading"]')).toHaveCount(0);
  await location.click();
  expect(await page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-active')][0].toString())).toContain('Cupertino');
});

test('LEAF retrieval finds measurements and rejects context-free numbers with the real models', async ({ page }, testInfo) => {
  await page.goto('/demo.html');
  await page.evaluate(() => {
    document.querySelector('main.guide')!.innerHTML = '<h2>Road distances</h2><p>The road extends for 20 miles between the towns.</p><p>The walking trail is six miles long.</p><p>20</p><p>6</p><p>36</p><p>Our café serves freshly baked pastries and coffee.</p>';
  });
  await open(page);
  await search(page, 'How many miles?');
  const displayed = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.results());
  const scores = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores());
  await testInfo.attach('hybrid-miles-scores', { body: JSON.stringify({ displayed, scores }), contentType: 'application/json' });
  expect(displayed.some((result: any) => result.text.includes('20 miles'))).toBe(true);
  expect(displayed.some((result: any) => /^(20|6|36)$/.test(result.text))).toBe(false);
  expect(displayed.every((result: any) => result.matchPercent >= 30 && !result.rerank)).toBe(true);
  expect(scores.filter((result: any) => /^(20|6|36)$/.test(result.text))).toHaveLength(3);
  await frame(page).getByRole('searchbox').fill('20');
  await expect(frame(page).locator('#status')).toHaveText(/^(Closest matches|No close matches\. Try another phrase\.)$/);
  expect(await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.results().some((result: any) => result.text === '20'))).toBe(false);
  // A same-query page edit bypasses panel ranking cache while preserving the
  // worker's embeddings for unchanged passages.
  await page.evaluate(() => document.querySelector('main.guide')!.append(Object.assign(document.createElement('p'), { textContent: 'A second road is 36 miles long.' })));
  await expect.poll(() => frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores().some((result: any) => result.text.includes('second road')))).toBe(true);
  const metrics = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(metrics.cacheHits).toBeGreaterThan(0);
  expect(metrics.rerankPairs).toBeUndefined();
});
async function open(page: Page) {
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await expect(frame(page).getByRole('searchbox')).toBeFocused();
  // Preserve the LEAF-only regression suite; reranker coverage lives in reranker.spec.ts.
  await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.setReranker(false));
}
async function search(page: Page, query: string) {
  await frame(page).getByRole('searchbox').fill(query);
  await expect(frame(page).locator('#status')).toHaveText('Closest matches', { timeout: 90_000 });
  expect(await frame(page).locator('#status').textContent()).toBe('Closest matches');
}

test('query edits during LEAF loading cancel stale results', async ({ page }) => {
  let release!: () => void;
  const loadingGate = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route('**/models/MongoDB/mdbr-leaf-ir/onnx/model*.onnx_data', async (route) => {
    requested = true;
    await loadingGate;
    await route.continue();
  });
  await page.goto('/demo.html');
  await open(page);
  await frame(page).getByRole('searchbox').fill('How can I send it back without a printer?');
  await expect.poll(() => requested, { timeout: 90_000 }).toBe(true);
  await frame(page).getByRole('searchbox').fill('When will I receive my refund?');
  release();
  await expect(frame(page).locator('#status')).toHaveText('Closest matches');
  await expect(frame(page).locator('.result').first()).toContainText('five business days');
  const candidates = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.candidates());
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates.every((result: any) => !result.rerank)).toBe(true);
  await page.waitForTimeout(300);
  await expect(frame(page).locator('.result').first()).toContainText('five business days');
});

async function expectPassageVisible(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const highlight = (CSS as any).highlights.get('semantic-find-active');
    if (!highlight?.size) return false;
    const rect = [...highlight][0].getBoundingClientRect();
    const panel = document.querySelector('[data-semantic-find="panel"]')!.getBoundingClientRect();
    const overlaps = rect.bottom > panel.top && rect.top < panel.bottom && rect.right > panel.left && rect.left < panel.right;
    return !overlaps && rect.top >= 0 && rect.bottom <= innerHeight;
  })).toBe(true);
}

test('real model ranks paraphrases, supports navigation, cancels edits, and stays local', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.log('browser:', message.text()); });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/demo.html');
  await open(page);
  await search(page, 'How can I send it back without a printer?');
  await expect(frame(page).locator('.result').first()).toContainText('QR code');
  await expect(frame(page).locator('.heading')).toHaveCount(0);
  const headings = await page.locator('main h1, main h2').allTextContents();
  const scored = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores());
  expect(headings.every((heading) => scored.some((result: any) => result.text === heading))).toBe(true);
  const displayed = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.results());
  expect(displayed.length).toBeLessThan(scored.length);
  expect(displayed.every((result: any) => result.matchPercent >= 30 && !result.rerank)).toBe(true);
  const metrics = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  await testInfo.attach('desktop-first-query-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' });
  await expect(frame(page).locator('#position')).toContainText('1 of ');
  const highlight = await page.evaluate(() => (CSS as any).highlights.get('semantic-find-active')?.size);
  expect(highlight).toBe(1);
  await frame(page).getByRole('searchbox').press('Enter');
  await expect(frame(page).locator('#position')).toHaveText(`${Math.min(2, displayed.length)} of ${displayed.length}`);
  await frame(page).getByRole('searchbox').press('Shift+Enter');
  await expect(frame(page).locator('#position')).toContainText('1 of ');
  await frame(page).getByRole('button', { name: 'Previous result', exact: true }).click();
  const position = await frame(page).locator('#position').innerText();
  expect(position.split(' of ')[0]).toEqual(position.split(' of ')[1]);
  await frame(page).getByRole('searchbox').fill('wrong query');
  await expect(frame(page).locator('.result')).toHaveCount(0);
  await frame(page).getByRole('searchbox').fill('Can I turn down the light at night?');
  await frame(page).getByRole('searchbox').press('Enter');
  await expect(frame(page).locator('#status')).toHaveText('Closest matches');
  // The off-the-shelf model can rank the on/off sentence above dimming;
  // keep that honest in the baseline instead of assuming perfect top-1 quality.
  expect((await frame(page).locator('.result').allTextContents()).slice(0, 3).join(' ')).toContain('lower the brightness');
  await expectPassageVisible(page);
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: false });
  await frame(page).getByRole('searchbox').fill(' ');
  await expect(frame(page).locator('#status')).toHaveText('Search by meaning, in your own words.');
  await expect(frame(page).locator('.result')).toHaveCount(0);
  await frame(page).getByRole('searchbox').press('Escape');
  await expect(page.locator('[data-semantic-find="panel"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(requests.filter((url) => !url.startsWith(`http://127.0.0.1:${process.env.PORT || 4173}/`))).toEqual([]);
});

test('extracts all 200+ sentences, inline text, visible roots and frames without duplicates', async ({ page }) => {
  await page.goto('/demo.html?long=1');
  await page.evaluate(() => {
    const paragraph = document.createElement('p'); paragraph.id = 'inline';
    paragraph.innerHTML = 'A café with <strong>excellent tea</strong> welcomes everyone. Another sentence follows.';
    document.body.append(paragraph);
    const hidden = document.createElement('p'); hidden.hidden = true; hidden.textContent = 'Invisible secret'; document.body.append(hidden);
    const field = document.createElement('textarea'); field.value = 'Private field'; document.body.append(field);
    const host = document.createElement('div'); const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Open shadow content.</p><slot></slot>'; host.innerHTML = '<span>Slotted content.</span>'; document.body.append(host);
    const iframe = document.createElement('iframe'); iframe.srcdoc = '<p>Same origin frame content.</p>'; document.body.append(iframe);
  });
  await expect(page.frameLocator('body > iframe').locator('p')).toHaveText('Same origin frame content.');
  const snapshot = await page.evaluate(() => (window as any).semanticFindDemo.extract());
  expect(snapshot.passages.length).toBeGreaterThan(260);
  const texts = snapshot.passages.map((passage: any) => passage.text);
  expect(texts).toContain('A café with excellent tea welcomes everyone.');
  expect(texts.filter((text: string) => text === 'Slotted content.')).toHaveLength(1);
  expect(texts).toContain('Same origin frame content.');
  expect(texts).toContain('Open shadow content.');
  expect(texts.join(' ')).not.toMatch(/Invisible secret|Private field|Describe what/);
});

test('scores the whole long page, including its final sentence', async ({ page }, testInfo) => {
  await page.goto('/demo.html?long=1');
  await open(page);
  await search(page, 'Where can someone in a wheelchair get into the building?');
  await expect(frame(page).locator('.result').first()).toContainText('wheelchair ramp');
  const metrics = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  const sentenceCount = await page.evaluate(() => (window as any).semanticFindDemo.extract().passages.filter((passage: any) => passage.kind === 'sentence').length);
  expect(metrics.sentences).toBe(sentenceCount);
  expect(metrics.sentences).toBeGreaterThan(250);
  expect(metrics.pairs).toBeGreaterThanOrEqual(metrics.sentences);
  await testInfo.attach('long-page-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' });
});

test('uses headings as context without displaying standalone heading results', async ({ page }) => {
  await page.goto('/demo.html');
  await page.evaluate(() => {
    document.querySelector('main.guide')!.innerHTML = '<h2>How can I return my purchase and get a full refund?</h2><p>The garden is planted with roses and lavender.</p>';
  });
  await open(page);
  await frame(page).getByRole('searchbox').fill('How can I return my purchase and get a full refund?');
  await expect(frame(page).locator('#status')).toHaveText(/Closest matches|No close matches/);
  await expect(frame(page).locator('.result[data-kind="heading"]')).toHaveCount(0);
  const scores = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores());
  expect(scores.find((r: any) => r.text.includes('full refund')).ranking.reason).toBe('heading context only');
  await page.evaluate(() => {
    document.querySelector('main.guide')!.innerHTML = '<h1>Return your purchase within thirty days for a full refund.</h1>';
  });
  await frame(page).getByRole('searchbox').fill('Return your purchase within thirty days for a full refund.');
  await expect(frame(page).locator('#status')).toHaveText('No close matches. Try another phrase.');
  await expect(frame(page).locator('.result')).toHaveCount(0);
  const metrics = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(metrics.sentences).toBe(0);
  expect(metrics.headings).toBe(1);
  expect(metrics.pairs).toBe(1);
});

test('refreshes results on page edits and handles oversized queries on a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo.html');
  await open(page);
  await search(page, 'My order arrived broken. What should I do?');
  await expect(frame(page).locator('.result').first()).toContainText('free replacement');
  await expectPassageVisible(page);
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: false });
  await page.evaluate(() => { document.querySelector('#damage')!.textContent = 'For a damaged delivery, contact Morgan at the repairs desk to arrange an exchange.'; });
  // A fresh sentence can fall below the relevance cutoff for the current query.
  // Check it was rescored automatically, then search for its specific new detail.
  await expect.poll(() => frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores().some((result: any) => result.text.includes('Morgan')))).toBe(true);
  await expect(frame(page).locator('.result').filter({ hasText: 'free replacement' })).toHaveCount(0);
  await search(page, 'Who should I contact to arrange an exchange for a damaged delivery?');
  await expect(frame(page).locator('.result').filter({ hasText: 'Morgan' })).toHaveCount(1);
  await frame(page).locator('.result').filter({ hasText: 'Morgan' }).click();
  expect(await page.evaluate(() => {
    const highlight = (CSS as any).highlights.get('semantic-find-active');
    return [...highlight][0].toString();
  })).toContain('Morgan');
  const metrics = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  await testInfo.attach('mobile-viewport-metrics-not-device-benchmark', { body: JSON.stringify(metrics), contentType: 'application/json' });
  // Both sentences must be scored, even if the relevance cutoff hides one.
  await page.evaluate(() => {
    const main = document.querySelector('main.guide')!;
    main.innerHTML = '<p>Show the QR code on your phone to return your lamp without a printer.</p><p>Our studio paints lamps in different colors.</p>';
  });
  const query = 'How can I return a lamp without a printer? '.repeat(70);
  await search(page, query);
  await expect(frame(page).getByRole('searchbox')).toHaveValue(query);
  await expect(frame(page).locator('.result').first()).toContainText('QR code');
  const longQueryMetrics = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(longQueryMetrics.sentences).toBe(2);
  expect(longQueryMetrics.pairs).toBeGreaterThan(2);
});

test('uses plain neighboring text without heading metadata, and keeps sections and roots separate', async ({ page }) => {
  await page.goto('/demo.html');
  await page.evaluate(() => {
    document.querySelector('main.guide')!.innerHTML = '<p>First plain sentence. Second plain sentence.</p><section><h2>Repeated title</h2><p>Third sentence. Fourth sentence.</p></section><section><h2>Repeated title</h2><p>Fifth sentence.</p></section>';
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow sentence.</p>';
    document.querySelector('main.guide')!.append(host);
  });
  const { passages } = await page.evaluate(() => (window as any).semanticFindDemo.extract());
  const sentences = passages.filter((passage: any) => passage.kind === 'sentence');
  expect(sentences.map((passage: any) => [passage.before, passage.after])).toEqual([
    ['', 'Second plain sentence.'], ['First plain sentence.', ''],
    ['', 'Fourth sentence.'], ['Third sentence.', ''], ['', ''], ['', ''],
  ]);
  expect(sentences.every((passage: any) => !('heading' in passage))).toBe(true);
  expect(sentences[2].contextGroup).not.toBe(sentences[4].contextGroup);
  expect(sentences[4].contextGroup).not.toBe(sentences[5].contextGroup);
});

for (const fallback of [false, true]) {
  test(`filters weak matches and highlights surrounding sentences ${fallback ? 'with overlay fallback' : 'with CSS Highlights'}`, async ({ page }) => {
    if (fallback) await page.addInitScript(() => Object.defineProperty(window, 'Highlight', { value: undefined, configurable: true }));
    await page.goto('/demo.html');
    await page.evaluate(() => {
      document.querySelector('main.guide')!.innerHTML = '<p id="first">Return your purchase within thirty days for a full refund.</p><p id="anchor">To receive your refund, bring the item and your order number to our returns desk.</p><p id="after">You can also return the item by post and receive the refund on your original payment card.</p><p>Our café serves pastries and fresh coffee every morning.</p><p>Jupiter has dozens of moons and a giant red storm.</p><p>The garden is planted with roses and lavender.</p><section><p>Return your purchase within thirty days for a full refund.</p></section>';
    });
    await open(page);
    const query = 'How can I return my purchase and get a full refund?';
    await search(page, query);
    await frame(page).locator('.result').filter({ hasText: 'bring the item' }).click();
    const scores = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores());
    const results = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.results());
    expect(scores).toHaveLength(7);
    expect(results).toHaveLength(4);
    expect(results.every((result: any) => result.matchPercent >= 30 && !result.rerank)).toBe(true);
    const contextMarks = page.locator('[data-highlight="context"]');
    if (fallback) {
      await expect(contextMarks.first()).toBeVisible();
      await expect(page.locator('[data-highlight="active"]').first()).toBeVisible();
    } else {
      await expect.poll(() => page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-context') ?? []].map((range: Range) => range.startContainer.parentElement?.id))).toEqual(['first', 'after']);
      expect(await page.evaluate(() => (CSS as any).highlights.get('semantic-find-active').priority > (CSS as any).highlights.get('semantic-find-context').priority)).toBe(true);
    }
    // The same relevant sentence in a separate section has no adjacent matches.
    await frame(page).locator('.result').filter({ hasText: 'within thirty days' }).last().click();
    if (fallback) await expect(contextMarks).toHaveCount(0);
    else await expect.poll(() => page.evaluate(() => (CSS as any).highlights.has('semantic-find-context'))).toBe(false);

    await frame(page).getByRole('searchbox').fill('What is the launch date of the next mission to Neptune?');
    await expect(frame(page).locator('#status')).toHaveText('No close matches. Try another phrase.');
    await expect(frame(page).locator('.result')).toHaveCount(0);
    await expect(frame(page).locator('.navigation')).toBeHidden();
    const emptyScores = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores());
    expect(emptyScores).toHaveLength(7); // Search still ran for every sentence.
    expect(emptyScores.every((result: any) => result.matchPercent < 30)).toBe(true);
    if (fallback) await expect(page.locator('[data-highlight]')).toHaveCount(0);
    else expect(await page.evaluate(() => (CSS as any).highlights.size)).toBe(0);

    await search(page, query); // Cached scores must restore filtering and context.
    await expect(frame(page).locator('.result')).toHaveCount(4);
    await frame(page).getByRole('searchbox').press('Escape');
    await expect(page.locator('[data-semantic-find="panel"]')).toHaveCount(0);
    if (fallback) await expect(page.locator('[data-highlight]')).toHaveCount(0);
    else expect(await page.evaluate(() => (CSS as any).highlights.size)).toBe(0);
  });
}


test('uses LEAF for short queries and reuses passage embeddings', async ({ page }) => {
  await page.goto('/demo.html');
  await open(page);
  await frame(page).getByRole('searchbox').fill('relaxation');
  await expect(frame(page).locator('#status')).toHaveText(/^(Closest matches|No close matches\. Try another phrase\.)$/);
  const scores = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores());
  const comfortable = scores.find((result: any) => result.text === 'Make yourself comfortable');
  expect(Number.isFinite(comfortable.score)).toBe(true);
  expect(comfortable.rerank).toBeUndefined();
  const first = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(first.embeddings).toBeGreaterThan(1);
  await search(page, 'printer-free return');
  await expect(frame(page).locator('.result').first()).toContainText('QR code');
  const repeated = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(repeated.embeddings).toBe(1);
  expect(repeated.cacheHits).toBe(repeated.sentences + repeated.headings);
});


test('scroll styling and identical DOM replacements preserve results while real text edits refresh them', async ({ page }) => {
  await page.goto('/demo.html?long=1');
  await open(page);
  await search(page, 'Where can someone in a wheelchair get into the building?');
  const original = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(original.inferenceBatches).toBeLessThan(original.embeddings / 2);
  await page.evaluate(() => {
    const main = document.querySelector('main.guide')!;
    main.classList.add('scroll-active');
    const paragraph = [...main.querySelectorAll('p')].find((node) => node.textContent?.includes('wheelchair ramp'))!;
    paragraph.replaceWith(paragraph.cloneNode(true));
    const image = document.createElement('img');
    image.alt = 'Loaded image';
    main.append(image);
  });
  await page.waitForTimeout(800);
  const after = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(after).toEqual(original);
  await expect(frame(page).locator('#status')).toHaveText('Closest matches');
  expect(await page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-active')][0].toString())).toContain('wheelchair ramp');
  await page.evaluate(() => {
    document.querySelector('main.guide')!.append(Object.assign(document.createElement('p'), { textContent: 'A second wheelchair ramp is available beside the west entrance.' }));
  });
  await expect.poll(() => frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores().some((result: any) => result.text.includes('west entrance')))).toBe(true);
  const changed = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(changed.embeddings).toBe(2); // One query and the newly added text.
  expect(changed.cacheHits).toBeGreaterThan(250);
});

test('uses section headings to boost body text and adapts paragraph versus sentence rows with layered highlights', async ({ page }) => {
  await page.goto('/demo.html');
  await page.evaluate(() => {
    document.querySelector('main.guide')!.innerHTML = '<nav><a href="#transport-title">Transportation</a></nav><section><h2 id="transport-title">Transportation</h2><p id="transport-paragraph">Regular buses connect towns across the county. Passenger trains run frequently between the city and surrounding suburbs.</p><h3>Roads and highways</h3><p>The local road network connects communities and workplaces.</p></section><section><h2>Food and drink</h2><p id="mixed">The tram stops beside the railway station. Our café sells pastries, fresh bread, and roasted coffee.</p></section><button>Transportation</button><p>Transportation.</p>';
  });
  const snapshot = await page.evaluate(() => (window as any).semanticFindDemo.extract());
  const byText = new Map(snapshot.passages.map((p: any) => [p.text, p]));
  const heading = snapshot.passages.find((p: any) => p.kind === 'heading' && p.text === 'Transportation');
  expect((byText.get('Regular buses connect towns across the county.') as any).sectionHeadingIds).toContain(heading.id);
  expect((byText.get('The tram stops beside the railway station.') as any).sectionHeadingIds).not.toContain(heading.id);
  await open(page);
  await search(page, 'transportation');
  await expect(frame(page).locator('.result[data-kind="heading"]')).toHaveCount(0);
  const ranked = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.results());
  expect(ranked[0].ranking.tier).toBe(1);
  const diagnostics = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores());
  expect(diagnostics.find((r: any) => r.passageId === heading.id).ranking.reason).toBe('heading context only');

  const paragraphText = await page.locator('#transport-paragraph').innerText();
  await search(page, paragraphText);
  const paragraph = frame(page).locator('.result[data-kind="paragraph"]').filter({ hasText: paragraphText });
  await expect(paragraph).toHaveCount(1);
  await paragraph.click();
  const selected = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.results().find((r: any) => r.paragraph?.text.includes('Regular buses')));
  const scores = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores());
  const focused = scores.find((r: any) => r.passageId === selected.paragraph.focus.passageId);
  expect(await page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-context')][0].toString())).toBe(paragraphText);
  expect(await page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-active')][0].toString())).toBe(focused.text.slice(selected.paragraph.focus.start, selected.paragraph.focus.end));
  expect(scores.some((r: any) => r.text === 'Regular buses connect towns across the county.')).toBe(true);

  const sentence = 'The tram stops beside the railway station.';
  await search(page, sentence);
  const row = frame(page).locator('.result').filter({ hasText: sentence });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-kind', 'sentence');
  await expect(row).toHaveText(sentence);
  await row.click();
  expect(await page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-active')][0].toString())).toBe(sentence);
});


for (const backend of ['auto', 'wasm'] as const)
test(`retains Apple founding details before selection and excludes navigation and bibliography (${backend})`, async ({ page }) => {
  await page.goto('/demo.html');
  await page.evaluate((html) => {
    document.querySelector('main.guide')!.innerHTML = html + '<nav><a href="#">Apple was founded by Steve Jobs.</a></nav><ol class="references"><li>Apple was founded by Steve Wozniak.</li></ol>';
  }, appleWikipedia);
  await open(page);
  await frame(page).locator('body').evaluate((_node, mode) => (window as any).semanticFindDev.setBackend(mode), backend);
  await search(page, 'Who founded Apple?');
  const founding = frame(page).locator('.result[data-kind="paragraph"]').filter({ hasText: 'April 1, 1976' }).first();
  await expect(founding).toBeVisible();
  expect(await founding.locator('.sentence').evaluate((node) => getComputedStyle(node).webkitLineClamp)).toBe('none');
  const rows = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.results());
  expect(rows.every((row: any) => Number.isFinite(row.questionScore))).toBe(true);
  expect(rows.some((row: any) => row.text === 'Apple was founded by Steve Wozniak.')).toBe(false);
  expect(rows.some((row: any) => row.text === 'Apple was founded by Steve Jobs.')).toBe(false);
  await founding.click();
  await expect(founding).toContainText('Ronald Wayne');
  expect(await page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-context')][0].toString())).toContain('April 1, 1976');
});

test('embeds identical paragraphs differently under Former games and Current games', async ({ page }) => {
  await page.goto('/demo.html');
  await page.evaluate(() => {
    document.querySelector('main.guide')!.innerHTML = '<h1>Attraction guide</h1><section><h2 id="former">Former games</h2><p>The balloon game uses darts to hit the targets. Players earn points for each balloon.</p></section><section><h2>Current games</h2><p>The balloon game uses darts to hit the targets. Players earn points for each balloon.</p></section>';
  });
  const snapshot = await page.evaluate(() => (window as any).semanticFindDemo.extract());
  const body = snapshot.passages.filter((p: any) => p.text === 'The balloon game uses darts to hit the targets.');
  await open(page);
  await search(page, 'former games');
  const scores = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.scores());
  const former = scores.find((r: any) => r.passageId === body[0].id);
  const current = scores.find((r: any) => r.passageId === body[1].id);
  expect(former.score).toBeGreaterThan(current.score);
  await expect(frame(page).locator('.result[data-kind="heading"]')).toHaveCount(0);
  const rows = await frame(page).locator('body').evaluate(() => (window as any).semanticFindDev.results());
  expect(rows[0].paragraph.blockId).toBe(body[0].blockId);
  await frame(page).locator('.result').first().click();
  expect(await page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-context')][0].toString())).toBe('The balloon game uses darts to hit the targets. Players earn points for each balloon.');
  expect(await page.evaluate(() => [...(CSS as any).highlights.get('semantic-find-active')][0].toString())).not.toContain('Former games');
});
