import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const fixtures = JSON.parse(await readFile(new URL('../fixtures/queries.json', import.meta.url), 'utf8'));
const rerankerLock = JSON.parse(await readFile(new URL('../reranker-lock.json', import.meta.url), 'utf8'));
const baseUrl = process.env.EVAL_BASE_URL || 'http://127.0.0.1:4173';
const backend = process.env.EVAL_BACKEND || 'auto';
const embeddingBatchSize = Number(process.env.EVAL_BATCH_SIZE || 8);
const useReranker = process.env.EVAL_RERANKER !== 'none';
const modelLock = JSON.parse(await readFile(new URL('../model-lock.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
const records = [];
let memorySamples = [];
const execFileAsync = promisify(execFile);
const cdp = await browser.newBrowserCDPSession();
async function sampleMemory() {
  if (process.platform === 'win32') return;
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  const ids = processInfo.map((info) => info.id).filter((id) => Number.isInteger(id) && id > 0);
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', ids.join(',')]);
  const kib = stdout.trim().split(/\s+/).reduce((sum, value) => sum + Number(value), 0);
  if (Number.isFinite(kib)) memorySamples.push(kib / 1024);
}
let sampling = false;
const sampler = setInterval(async () => {
  if (sampling) return;
  sampling = true;
  try { await sampleMemory(); } catch { /* RSS unavailable on this host. */ }
  finally { sampling = false; }
}, 250);
try {
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  await page.goto(`${baseUrl}/demo.html`);
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  const panel = page.frameLocator('[data-semantic-find="panel"] iframe');
  await panel.locator('body').evaluate((element, options) => window.semanticFindDev.setBackend(options.backend, options.embeddingBatchSize), { backend, embeddingBatchSize });
  await panel.locator('body').evaluate((element, enabled) => window.semanticFindDev.setReranker(enabled), useReranker);
  expect(await panel.locator('body').evaluate(() => !!window.semanticFindDev.settings().reranker)).toBe(useReranker);
  let settings;
  for (const fixture of fixtures) {
    const relevant = await page.evaluate((ids) => ids.map((id) => document.getElementById(id).textContent), fixture.relevantElementIds);
    await panel.getByRole('searchbox').fill(fixture.query);
    console.error(`Evaluating: ${fixture.query}`);
    await expect.poll(() => panel.locator('body').evaluate(() => window.semanticFindDev.metrics()?.effectiveQuery), { timeout: 90000 }).toBe(fixture.query);
    await panel.locator('#status').filter({ hasText: /^(Closest matches|No close matches\.)/ }).waitFor({ timeout: 90_000 });
    const result = await panel.locator('body').evaluate(() => ({ results: window.semanticFindDev.results(), candidates: window.semanticFindDev.candidates(), scores: window.semanticFindDev.scores(), metrics: window.semanticFindDev.metrics(), settings: window.semanticFindDev.settings() }));
    settings = result.settings;
    const rank = result.results.findIndex((entry) => relevant.includes(entry.text)) + 1;
    const retrievalRank = result.candidates.findIndex((entry) => relevant.includes(entry.text)) + 1;
    const unfilteredRank = [...result.scores].sort((a, b) => b.score - a.score).findIndex((entry) => relevant.includes(entry.text)) + 1;
    records.push({ query: fixture.query, rank, retrievalRank, unfilteredRank, visibleMatches: result.results.length, topResult: result.results[0]?.text, metrics: result.metrics });
  }
  await page.goto(`${baseUrl}/demo.html?long=1`);
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  const longPanel = page.frameLocator('[data-semantic-find="panel"] iframe');
  await longPanel.locator('body').evaluate((element, options) => window.semanticFindDev.setBackend(options.backend, options.embeddingBatchSize), { backend, embeddingBatchSize });
  await longPanel.locator('body').evaluate((element, enabled) => window.semanticFindDev.setReranker(enabled), useReranker);
  expect(await longPanel.locator('body').evaluate(() => !!window.semanticFindDev.settings().reranker)).toBe(useReranker);
  await longPanel.getByRole('searchbox').fill('Where can someone in a wheelchair get into the building?');
  await longPanel.locator('#status').filter({ hasText: /^(Closest matches|No close matches\.)/ }).waitFor({ timeout: 90_000 });
  const longPage = await longPanel.locator('body').evaluate(() => ({ topResult: window.semanticFindDev.results()[0]?.text, metrics: window.semanticFindDev.metrics() }));
  const report = {
    generatedAt: new Date().toISOString(),
    model: modelLock.id, revision: modelLock.revision,
    modelFiles: modelLock.files.filter((asset) => /\.onnx(?:_data)?$/.test(asset.path)),
    reranker: useReranker ? { id: rerankerLock.id, revision: rerankerLock.revision } : null,
    settings,
    device: { platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model, browser: browser.version(), runtime: records[0]?.metrics.embeddingRuntime, rerankerRuntime: records[0]?.metrics.rerankerRuntime },
    note: 'Synthetic development fixtures, not a held-out benchmark or a phone measurement.',
    reciprocalRank: records.reduce((sum, record) => sum + (record.rank ? 1 / record.rank : 0), 0) / records.length,
    recallAt3: records.filter((record) => record.rank > 0 && record.rank <= 3).length / records.length,
    longPage,
    memory: { sampledPeakBrowserProcessRssMiB: memorySamples.length ? Math.max(...memorySamples) : null, samples: memorySamples.length, note: '250ms RSS samples summed across this isolated Chromium browser, including its renderer/GPU/utility processes; shared pages can be double counted. This is not model-only memory or a physical-phone peak.' },
    records,
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile(`artifacts/${process.env.EVAL_LABEL || 'evaluation'}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { clearInterval(sampler); await browser.close(); }
