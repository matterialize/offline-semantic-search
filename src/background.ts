import browser from 'webextension-polyfill';
import type { BridgeMessage } from './types';

type Port = browser.Runtime.Port;
interface Session { content?: Port; panel?: Port; tabId: number; pending: BridgeMessage[] }
const sessions = new Map<string, Session>();

async function open(tabId?: number) {
  if (tabId === undefined) return;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await browser.action.setBadgeText({ tabId, text: '' });
    await browser.action.setTitle({ tabId, title: 'Search this page by meaning' });
  } catch {
    await browser.action.setBadgeText({ tabId, text: '!' });
    await browser.action.setTitle({ tabId, title: 'This page cannot be searched. Open a regular webpage and try again.' });
  }
}

browser.action.onClicked.addListener((tab) => void open(tab.id));
browser.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-search') return;
  if (tab?.id !== undefined) void open(tab.id);
  else void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => open(active?.id));
});

browser.runtime.onConnect.addListener((port) => {
  const [kind, id] = port.name.split(':');
  if (!id || !['content', 'panel'].includes(kind)) { port.disconnect(); return; }
  const sender = port.sender;
  if (sender?.id !== browser.runtime.id) { port.disconnect(); return; }
  if (kind === 'content') {
    if (sender.tab?.id === undefined || sender.frameId !== 0) { port.disconnect(); return; }
    sessions.set(id, { content: port, tabId: sender.tab.id, pending: [] });
  } else {
    const session = sessions.get(id);
    const panelUrl = browser.runtime.getURL('panel.html');
    if (!session || sender.url?.split('#')[0] !== panelUrl || (sender.tab?.id !== undefined && sender.tab.id !== session.tabId)) {
      port.disconnect(); return;
    }
    session.panel = port;
    for (const message of session.pending) port.postMessage(message);
    session.pending = [];
  }
  port.onMessage.addListener((value) => {
    const message = value as BridgeMessage;
    const session = sessions.get(id);
    if (!session || session[kind as 'content' | 'panel'] !== port) return;
    const peer = kind === 'content' ? session.panel : session.content;
    try {
      if (peer) peer.postMessage(message);
      else if (kind === 'content' && message.type === 'focus') session.pending = [message];
    } catch { /* Tab or panel closed between event delivery and send. */ }
  });
  port.onDisconnect.addListener(() => {
    const session = sessions.get(id);
    if (!session || session[kind as 'content' | 'panel'] !== port) return;
    sessions.delete(id);
    try { (kind === 'content' ? session.panel : session.content)?.disconnect(); } catch { /* Already gone. */ }
  });
});


// Compile-time constants keep the reload client out of production builds.
declare const __DEV_RELOAD_URL__: string;
declare const __DEV_REVISION__: string;
if (__DEV_RELOAD_URL__) {
  void import('./dev-reload').then(({ startDevReload }) => startDevReload(__DEV_RELOAD_URL__, __DEV_REVISION__, () => {
    for (const session of sessions.values()) {
      try { session.content?.postMessage({ type: 'close' }); } catch { /* Already closed. */ }
    }
  }));
}
