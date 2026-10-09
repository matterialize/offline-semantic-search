import type { BridgeMessage } from '../types';
import { PageIndex, OWN_ATTRIBUTE, isOwnNode } from './extract';
import { PageHighlight } from './highlight';

export interface Transport {
  send(message: BridgeMessage): void;
  listen(callback: (message: BridgeMessage) => void): void;
  close(): void;
}

export function mountPanel(options: {
  url: string;
  transport: Transport;
  onClose(): void;
}) {
  const { transport } = options;
  const index = new PageIndex(document);
  const highlight = new PageHighlight();
  const previousFocus = document.activeElement as HTMLElement | null;
  let dirty = true;
  let selected: Extract<BridgeMessage, { type: 'select' }> | undefined;
  let disposed = false;
  let desiredHeight = 190;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const observers: MutationObserver[] = [];
  const host = document.createElement('div');
  host.setAttribute(OWN_ATTRIBUTE, 'panel');
  host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;display:block!important;color-scheme:light dark!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const frame = document.createElement('iframe');
  frame.src = options.url;
  frame.title = 'Offline Semantic Search — search this page';
  frame.allow = 'clipboard-write';
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;border-radius:12px;box-shadow:0 8px 32px rgba(47,39,30,.22);background:transparent;color-scheme:light dark!important;';
  shadow.append(frame);

  const layout = () => {
    const viewport = window.visualViewport;
    const height = viewport?.height ?? innerHeight;
    const mobile = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
    const panelHeight = Math.min(desiredHeight, Math.max(180, height * (mobile ? .5 : .75)), height - 24);
    host.style.setProperty('height', `${panelHeight}px`, 'important');
    host.style.setProperty('width', mobile ? 'calc(100% - 24px)' : '380px', 'important');
    host.style.setProperty('right', '12px', 'important');
    host.style.setProperty('top', mobile ? 'auto' : `${12 + (viewport?.offsetTop ?? 0)}px`, 'important');
    host.style.setProperty('bottom', mobile ? `${12 + Math.max(0, innerHeight - height - (viewport?.offsetTop ?? 0))}px` : 'auto', 'important');
  };
  window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('scroll', layout);
  const refresh = () => {
    clearTimeout(changeTimer);
    const previous = index.snapshot.id;
    index.extract();
    dirty = false;
    watch();
    return index.snapshot.id !== previous;
  };
  const showSelected = (message: Extract<BridgeMessage, { type: 'select' }>, scroll = true) => {
    const paragraph = message.result.paragraph;
    const focused = paragraph?.focus ?? message.result;
    const range = index.range(message.snapshotId, focused.passageId, focused.start, focused.end);
    const context = paragraph ? [index.blockRange(message.snapshotId, paragraph.blockId)]
      : message.context.map((result) => index.range(message.snapshotId, result.passageId, result.start, result.end));
    if (!range || context.some((neighbor) => neighbor === null)) return false;
    highlight.show(range, host, context as Range[], scroll);
    return true;
  };
  const changed = () => {
    if (disposed) return;
    dirty = true;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      if (refresh()) {
        selected = undefined;
        highlight.clear();
        transport.send({ type: 'changed' });
      } else if (selected) {
        // DOM nodes can be replaced with identical text. Refresh their ranges
        // without restarting inference or scrolling back to the selected result.
        showSelected(selected, false);
      }
    }, 250);
  };
  const watch = () => {
    for (const observer of observers) observer.disconnect();
    observers.length = 0;
    for (const root of index.roots) {
      const observer = new MutationObserver((records) => {
        const meaningful = records.some((record) => {
          if (isOwnNode(record.target)) return false;
          if (record.type === 'childList') {
            const nodes = [...record.addedNodes, ...record.removedNodes];
            if (nodes.length && nodes.every(isOwnNode)) return false;
          }
          return true;
        });
        if (meaningful) changed();
      });
      observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'role', 'aria-hidden', 'contenteditable'] });
      observers.push(observer);
    }
  };
  const close = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(changeTimer);
    observers.forEach((observer) => observer.disconnect());
    highlight.clear();
    host.remove();
    window.removeEventListener('resize', layout);
    window.visualViewport?.removeEventListener('resize', layout);
    window.visualViewport?.removeEventListener('scroll', layout);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('load', onLoad, true);
    transport.close();
    previousFocus?.focus({ preventScroll: true });
    options.onClose();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  };
  const onLoad = (event: Event) => { if ((event.target as Element)?.tagName === 'IFRAME' && event.target !== frame) changed(); };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('load', onLoad, true);
  transport.listen((message) => {
    if (disposed) return;
    switch (message.type) {
      case 'extract': {
        if (dirty) refresh();
        transport.send({ type: 'snapshot', generation: message.generation, snapshot: index.snapshot });
        break;
      }
      case 'select': {
        if (dirty && refresh()) {
          selected = undefined;
          highlight.clear();
          transport.send({ type: 'changed' });
          break;
        }
        selected = message;
        if (!showSelected(message)) changed();
        break;
      }
      case 'clear': selected = undefined; highlight.clear(); break;
      case 'close': close(); break;
      case 'resize': desiredHeight = Math.max(140, Math.min(520, message.height)); layout(); break;
    }
  });
  document.documentElement.append(host);
  layout();
  return {
    open() { transport.send({ type: 'focus' }); frame.focus(); },
    close,
  };
}
