import { chromium, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const folder = await mkdtemp(path.join(os.tmpdir(), 'semantic-find-screenshots-'));
const extension = path.join(folder, 'extension');
const port = 4175;
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverError = '';
server.stderr.on('data', (bytes) => { serverError += bytes; });
let context;
try {
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(serverError || 'Screenshot server exited');
    try { return (await fetch(`http://127.0.0.1:${port}/demo.html`)).ok; } catch { return false; }
  }).toBe(true);
  await cp('dist', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Only the disposable screenshot copy has localhost permission. The release
  // manifest remains activeTab-only; this substitutes for clicking browser chrome.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(folder, 'profile'), {
    channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await mkdir('docs/screenshots', { recursive: true });
  await mkdir('store-assets', { recursive: true });
  for (const shot of [
    { file: 'desktop.png', scheme: 'light', width: 1280, height: 800 },
    { file: 'desktop-dark.png', scheme: 'dark', width: 1280, height: 800 },
    { file: 'mobile.png', scheme: 'light', width: 390, height: 844 },
  ]) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: shot.width, height: shot.height });
    await page.emulateMedia({ colorScheme: shot.scheme, reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:${port}/demo.html`);
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    });
    const panel = page.frameLocator('[data-semantic-find="panel"] iframe');
    await panel.getByRole('searchbox').fill('Return without a printer');
    await expect(panel.locator('#status')).toHaveText('Closest matches', { timeout: 90000 });
    await expect(panel.locator('.result').first()).toContainText('QR code');
    const metrics = await panel.locator('body').evaluate(() => window.semanticFindDev.metrics());
    expect(metrics.rerankPairs).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => {
      const range = [...CSS.highlights.get('semantic-find-active')][0];
      const rect = range.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
    await page.screenshot({ path: `docs/screenshots/${shot.file}`, animations: 'disabled' });
    expect(errors).toEqual([]);
    console.log(`Captured ${shot.file}: ${shot.width}×${shot.height}, actual extension with LEAF + Ettin`);
    await page.close();
  }
  await cp('dist/icons/icon-128.png', 'store-assets/icon-128.png');
  const icon = await sharp(await readFile('src/icon.svg')).resize(160, 160).png().toBuffer();
  const background = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280"><rect width="440" height="280" fill="#302923"/><rect x="80" y="36" width="280" height="208" rx="24" fill="#44382f"/><path d="M106 78h54M106 98h32M292 182h42M278 202h56" stroke="#a38b78" stroke-width="6" stroke-linecap="round"/></svg>');
  await sharp(background).composite([{ input: icon, left: 140, top: 60 }]).png().toFile('store-assets/promo-440x280.png');
} finally {
  await context?.close();
  server.kill();
  await rm(folder, { recursive: true, force: true });
}
