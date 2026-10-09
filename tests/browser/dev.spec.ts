import { chromium, expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

test('development watcher reloads the extension and reopens on the same page', async ({}, testInfo) => {
  const dev = spawn(process.execPath, ['scripts/dev.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  dev.stdout.on('data', (data) => { output += String(data); });
  dev.stderr.on('data', (data) => { output += String(data); });
  const marker = path.resolve(`src/__dev_reload_probe_${process.pid}.ts`);
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const version = async () => {
      try {
        const response = await fetch('http://127.0.0.1:4174/version');
        return response.ok ? await response.text() : '';
      } catch { return ''; }
    };
    await expect.poll(version, { timeout: 30_000 }).not.toBe('');
    const initial = await version();
    const production = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
    expect(production.host_permissions).toBeUndefined();
    expect(await readFile('dist/background.js', 'utf8')).not.toContain('127.0.0.1:4174');
    context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
      channel: 'chromium', headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      args: [`--disable-extensions-except=${path.resolve('dist-dev')}`, `--load-extension=${path.resolve('dist-dev')}`],
    });
    // Command-line loading bypasses the initial Developer mode check, but
    // runtime.reload enforces it. Match the user's Load unpacked workflow.
    const management = await context.newPage();
    await management.goto('chrome://extensions');
    await management.evaluate(async () => await (globalThis as any).chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    await management.close();
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${process.env.PORT || 4173}/demo.html?strict=1`);
    const inject = (target: typeof worker) => target.evaluate(async () => {
      const chrome = (globalThis as any).chrome;
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
      await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] });
    });
    await inject(worker);
    const panel = page.frameLocator('[data-semantic-find="panel"] iframe');
    await expect(panel.getByRole('searchbox')).toBeFocused();
    await panel.getByRole('searchbox').fill('How can I send it back without a printer?');
    await expect(panel.locator('.result').first()).toContainText('QR code');
    await page.evaluate(() => { (window as any).devPageSurvived = true; });
    const stopped = new Promise<void>((resolve) => worker.once('close', () => resolve()));
    const reloaded = context.waitForEvent('serviceworker', { predicate: (next) => next !== worker, timeout: 15_000 }).catch(() => undefined);
    await writeFile(marker, '// Trigger a development rebuild.\n');
    await expect.poll(version, { timeout: 30_000 }).not.toBe(initial);
    await expect(page.locator('[data-semantic-find="panel"]')).toHaveCount(0);
    // runtime.reload stops the old worker. Opening an extension page wakes the
    // new one, like clicking its action would in an interactive browser.
    await stopped;
    const wake = await context.newPage();
    await expect.poll(async () => {
      try { await wake.goto(`chrome-extension://${extensionId}/panel.html#dev-test`); return true; }
      catch { return false; }
    }, { timeout: 15_000 }).toBe(true);
    const next = await reloaded;
    expect(next).toBeDefined();
    await wake.close();
    expect(await page.evaluate(() => (window as any).devPageSurvived)).toBe(true);
    await inject(next!);
    await expect(panel.getByRole('searchbox')).toBeFocused();
    await panel.getByRole('searchbox').fill('How can I send it back without a printer?');
    await expect(panel.locator('.result').first()).toContainText('QR code');
  } finally {
    await context?.close();
    const exited = new Promise<void>((resolve) => { if (dev.exitCode !== null) resolve(); else dev.once('exit', () => resolve()); });
    dev.kill('SIGTERM');
    await exited;
    await rm(marker, { force: true });
    await testInfo.attach('development-watcher-output', { body: output, contentType: 'text/plain' });
  }
});
