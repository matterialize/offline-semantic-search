import { chromium, expect } from '@playwright/test';
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const folder = path.resolve('artifacts/wikipedia-extension');
await cp('dist', folder, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['https://en.wikipedia.org/*'];
await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(path.resolve('artifacts/wikipedia-profile'), {
 executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, headless: true,
 args: [`--disable-extensions-except=${folder}`, `--load-extension=${folder}`],
});
try {
 await context.addInitScript(() => {
  const Original = window.Worker;
  window.workerTraffic = [];
  window.Worker = class extends Original {
   postMessage(message, ...args) {
    window.workerTraffic.push({ type: message.type, generation: message.generation, at: performance.now(), passages: message.snapshot?.passages.length });
    return super.postMessage(message, ...args);
   }
  };
 });
 const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
 const page = await context.newPage();
 page.on('console', message => { if (message.type() === 'error') console.log('browser:', message.text()); });
 const url = 'https://en.wikipedia.org/wiki/Apple_Inc.';
 await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
 await page.evaluate(() => {
  window.mutationLog = [];
  new MutationObserver(records => {
   for (const record of records) {
    if (record.target.closest?.('[data-semantic-find]')) continue;
    if (window.mutationLog.length < 200) window.mutationLog.push({type: record.type, attribute: record.attributeName, tag: record.target.nodeName, id: record.target.id, class: record.target.className?.toString(), added: record.addedNodes.length });
   }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class','style','hidden','open','role','aria-hidden','contenteditable'] });
 });
 await worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://en.wikipedia.org/*' });
  await chrome.scripting.executeScript({ target: {tabId: tab.id}, files: ['content.js'] });
 });
 const panel = page.frameLocator('[data-semantic-find="panel"] iframe');
 if (process.env.PROFILE_RERANKER === 'none') await panel.locator('body').evaluate(() => semanticFindDev.setReranker(false));
 await panel.getByRole('searchbox').fill(process.env.PROFILE_QUERY || 'Who founded Apple?');
 await panel.locator('#status').filter({hasText: /^(Closest matches|No close matches\.)/}).waitFor({timeout: 180000});
 const first = await panel.locator('body').evaluate(() => ({ metrics: semanticFindDev.metrics(), traffic: workerTraffic, results: semanticFindDev.results().slice(0, 5), scores: semanticFindDev.scores(), visibleCount: semanticFindDev.results().length, candidates: semanticFindDev.candidates(), numericResults: semanticFindDev.results().filter(result => !/\p{L}/u.test(result.text) && /\p{N}/u.test(result.text)) }));
 console.log('FIRST', JSON.stringify({ metrics: first.metrics, results: first.results, numericResults: first.numericResults }));
 await page.evaluate(() => { window.mutationLog = []; document.querySelector('#External_links')?.scrollIntoView(); window.scrollTo(0, document.body.scrollHeight); });
 await page.waitForTimeout(1500);
 const after = await panel.locator('body').evaluate(() => ({ metrics: semanticFindDev.metrics(), traffic: workerTraffic, status: document.querySelector('#status').textContent }));
 const mutations = await page.evaluate(() => mutationLog);
 console.log('AFTER', JSON.stringify({ ...after, mutations }));
 await mkdir('artifacts', { recursive: true });
 const warmQuery = process.env.PROFILE_WARM_QUERY || 'Where is Apple headquartered?';
 await panel.getByRole('searchbox').fill(warmQuery);
 await expect.poll(() => panel.locator('body').evaluate(() => semanticFindDev.metrics()?.effectiveQuery), { timeout: 180000 }).toBe(warmQuery);
 await panel.locator('#status').filter({hasText: /^(Closest matches|No close matches\.)/}).waitFor({timeout: 180000});
 const warm = await panel.locator('body').evaluate(() => ({ metrics: semanticFindDev.metrics(), traffic: workerTraffic, results: semanticFindDev.results(), scores: semanticFindDev.scores() }));
 console.log('WARM', JSON.stringify(warm));
 await writeFile(`artifacts/wikipedia-${process.env.PROFILE_LABEL || 'baseline'}.json`, JSON.stringify({url, query: process.env.PROFILE_QUERY || 'Who founded Apple?', first, after, mutations, warm},null,2)+'\n');
} finally { await context.close(); }
