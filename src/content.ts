import browser from 'webextension-polyfill';
import { mountPanel } from './page/panel-host';
import type { BridgeMessage } from './types';
import { newSession } from './session';

const scope = globalThis as typeof globalThis & { __semanticFind?: ReturnType<typeof mountPanel> };
if (scope.__semanticFind) scope.__semanticFind.open();
else {
  const session = newSession();
  const port = browser.runtime.connect({ name: `content:${session}` });
  const instance = mountPanel({
    url: `${browser.runtime.getURL('panel.html')}#${session}`,
    transport: {
      send: (message) => { try { port.postMessage(message); } catch { instance.close(); } },
      listen: (callback) => port.onMessage.addListener((message) => callback(message as BridgeMessage)),
      close: () => port.disconnect(),
    },
    onClose: () => { delete scope.__semanticFind; },
  });
  scope.__semanticFind = instance;
  port.onDisconnect.addListener(() => instance.close());
}
