import browser from 'webextension-polyfill';

/** Development only: fetch a build marker, never webpage content or code. */
export function startDevReload(url: string, revision: string, beforeReload: () => void) {
  let checking = false;
  let reloading = false;
  async function check() {
    if (checking || reloading) return;
    checking = true;
    try {
      // Keep the development MV3 worker awake while the watcher is running.
      await browser.runtime.getPlatformInfo();
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
      if (!response.ok) return;
      const current = await response.text();
      if (current && current !== revision) {
        reloading = true;
        beforeReload();
        // Let content scripts remove panels/highlights before invalidating ports.
        setTimeout(() => browser.runtime.reload(), 100);
      }
    } catch { /* Watcher stopped; manual extension reload remains available. */ }
    finally { checking = false; }
  }
  const timer = setInterval(() => void check(), 1000);
  void check();
  return () => clearInterval(timer);
}
