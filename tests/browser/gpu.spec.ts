import { expect, test, type Page } from '@playwright/test';

const panel = (page: Page) => page.frameLocator('[data-semantic-find="panel"] iframe');
async function requireGpu(page: Page) {
  await page.goto('/demo.html');
  const supported = await page.evaluate(async () => {
    const adapter = await (navigator as any).gpu?.requestAdapter({ powerPreference: 'high-performance' });
    return !!adapter && adapter.features.has('shader-f16') && !adapter.info?.isFallbackAdapter;
  });
  test.skip(!supported, 'A hardware WebGPU adapter with FP16 is required');
}

test('runs both real models on GPU, batches pairs and reuses unchanged embeddings', async ({ page }) => {
  await requireGpu(page);
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await panel(page).locator('body').evaluate(() => (window as any).semanticFindDev.setBackend('webgpu'));
  await panel(page).getByRole('searchbox').fill('How can I send it back without a printer?');
  await expect(panel(page).locator('.result').first()).toContainText('QR code');
  const first = await panel(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(first.embeddingRuntime).toMatchObject({ device: 'webgpu', dtype: 'q4f16' });
  expect(first.rerankerRuntime).toMatchObject({ device: 'webgpu', dtype: 'fp32' });
  expect(first.rerankBatches).toBeLessThan(first.rerankPairs);
  await panel(page).getByRole('searchbox').fill('When will I get my money back?');
  await expect(panel(page).locator('.result').first()).toContainText('five business days');
  const warm = await panel(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(warm.embeddingRuntime.device).toBe('webgpu');
  expect(warm.embeddings).toBe(1);
  expect(warm.cacheHits).toBeGreaterThan(0);
});

test('finishes a search on CPU when the GPU model cannot initialize', async ({ page }) => {
  await requireGpu(page);
  await page.route('**/models/MongoDB/mdbr-leaf-ir/onnx/model_q4f16.onnx', (route) =>
    route.fulfill({ status: 200, body: 'Invalid ONNX graph for fallback testing' }));
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await panel(page).locator('body').evaluate(() => (window as any).semanticFindDev.setBackend('webgpu'));
  await panel(page).getByRole('searchbox').fill('How can I send it back without a printer?');
  await expect(panel(page).locator('.result').first()).toContainText('QR code');
  const metrics = await panel(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(metrics.embeddingRuntime).toMatchObject({ device: 'wasm', dtype: 'q8', fallback: 'GPU initialization failed' });
  expect(metrics.rerankerRuntime.device).toBe('wasm');
});

test('runs without navigator.gpu in the inference worker', async ({ page }) => {
  await page.route('**/assets/worker-*.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: "Object.defineProperty(navigator, 'gpu', { value: undefined });\n" + await response.text() });
  });
  await page.goto('/demo.html');
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await panel(page).getByRole('searchbox').fill('How can I send it back without a printer?');
  await expect(panel(page).locator('.result').first()).toContainText('QR code');
  const metrics = await panel(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(metrics.embeddingRuntime.device).toBe('wasm');
  expect(metrics.rerankerRuntime.device).toBe('wasm');
});

test('restarts the worker on CPU after GPU reranker initialization fails', async ({ page }) => {
  await requireGpu(page);
  await page.route('**/models/cross-encoder/ettin-reranker-17m-v1/onnx/model.onnx', (route) =>
    route.fulfill({ status: 200, body: 'Invalid ONNX graph for fallback testing' }));
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await panel(page).getByRole('searchbox').fill('How can I send it back without a printer?');
  await expect(panel(page).locator('.result').first()).toContainText('QR code');
  const metrics = await panel(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(metrics.embeddingRuntime.device).toBe('wasm');
  expect(metrics.rerankerRuntime).toMatchObject({ device: 'wasm', dtype: 'q8', fallback: 'GPU initialization failed' });
});

test('auto runs low-precision LEAF embeddings and reranking on GPU', async ({ page }) => {
  await requireGpu(page);
  await page.getByRole('button', { name: 'Search this page', exact: true }).click();
  await panel(page).getByRole('searchbox').fill('How can I send it back without a printer?');
  await expect(panel(page).locator('.result').first()).toContainText('QR code');
  const metrics = await panel(page).locator('body').evaluate(() => (window as any).semanticFindDev.metrics());
  expect(metrics.embeddingRuntime).toMatchObject({ device: 'webgpu', dtype: 'q4f16' });
  expect(metrics.rerankerRuntime).toMatchObject({ device: 'webgpu', dtype: 'fp32' });
});
