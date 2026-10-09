import { chromium, expect, test } from '@playwright/test';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

for (const backend of ['auto', 'wasm', 'webgpu'] as const) test(`packaged extension (${backend}) runs a cold search offline on a restrictive page and can reopen`, async ({}, testInfo) => {
  const extension = testInfo.outputPath('extension');
  await cp(path.resolve(process.env.EXTENSION_UNDER_TEST || 'dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Test automation cannot click browser chrome to grant activeTab. Grant only
  // the local fixture host in this disposable copy; the shipped manifest stays unchanged.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium', headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') console.log('extension:', message.text()); });
    context.on('request', (request) => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${process.env.PORT || 4173}/demo.html?strict=1`);
    await context.setOffline(true);
    const inject = () => worker.evaluate(async () => {
      const chrome = (globalThis as any).chrome;
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
      await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] });
    });
    await inject();
    const panel = page.frameLocator('[data-semantic-find="panel"] iframe');
    await expect(panel.getByRole('searchbox')).toBeFocused();
    await panel.locator('body').evaluate((_, value) => (window as any).semanticFindDev.setBackend(value), backend);
    await panel.getByRole('searchbox').fill('How can I send it back without a printer?');
    await expect(panel.locator('.result').first()).toContainText('QR code', { timeout: 60_000 });
    const metrics = await panel.locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
    expect(metrics.candidates).toBeGreaterThan(0);
    expect(metrics.rerankPairs).toBeGreaterThan(0);
    expect(metrics.reranker).toBe('cross-encoder/ettin-reranker-17m-v1');
    const rerankerFile = metrics.rerankerRuntime.device === 'webgpu' ? 'model.onnx' : 'model_qint8_arm64.onnx';
    expect(requests.some((url) => url.includes(`/models/cross-encoder/ettin-reranker-17m-v1/onnx/${rerankerFile}`))).toBe(true);
    const rows = await panel.locator('body').evaluate(() => (window as any).semanticFindDev.results());
    expect(rows.every((row: any) => Number.isFinite(row.rerankScore))).toBe(true);
    expect(rows.map((row: any) => row.rerankScore)).toEqual(rows.map((row: any) => row.rerankScore).sort((a: number, b: number) => b - a));
    expect(requests.some((url) => url.includes('/models/Xenova/'))).toBe(false);
    const embeddingFile = metrics.embeddingRuntime.device === 'webgpu' ? 'model_q4f16.onnx_data' : 'model_quantized.onnx_data';
    expect(requests.some((url) => url.includes(`/models/MongoDB/mdbr-leaf-ir/onnx/${embeddingFile}`))).toBe(true);
    if (backend === 'wasm') expect(metrics.embeddingRuntime.device).toBe('wasm');
    await testInfo.attach('extension-cold-offline-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' });
    await inject();
    await expect(page.locator('[data-semantic-find="panel"]')).toHaveCount(1);
    await expect(panel.getByRole('searchbox')).toBeFocused();
    expect(await panel.getByRole('searchbox').evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!)).toBeGreaterThan(0);
    await panel.getByRole('searchbox').press('Escape');
    await expect(page.locator('[data-semantic-find="panel"]')).toHaveCount(0);
    await inject();
    await expect(panel.getByRole('searchbox')).toBeFocused();
    expect(errors).toEqual([]);
    expect(requests.filter((url) => /^https?:/.test(url) && !url.startsWith(`http://127.0.0.1:${process.env.PORT || 4173}/`))).toEqual([]);
  } finally { await context.close(); }
});
