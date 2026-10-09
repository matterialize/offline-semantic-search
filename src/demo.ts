import './demo.css';
import { mountPanel } from './page/panel-host';
import { PageIndex } from './page/extract';
import { newSession } from './session';

let panel: ReturnType<typeof mountPanel> | undefined;
function open() {
  if (panel) { panel.open(); return; }
  const session = newSession();
  const channel = new BroadcastChannel(`semantic-find-demo:${session}`);
  panel = mountPanel({
    url: `./panel.html#${session}`,
    transport: {
      send: (message) => channel.postMessage(message),
      listen: (callback) => { channel.onmessage = (event) => callback(event.data); },
      close: () => channel.close(),
    },
    onClose: () => { panel = undefined; },
  });
}
document.querySelector('#open-search')!.addEventListener('click', open);
document.querySelectorAll<HTMLButtonElement>('[data-query]').forEach((button) => {
  button.addEventListener('click', () => {
    open();
    const frame = document.querySelector('[data-semantic-find="panel"]')!.shadowRoot!.querySelector('iframe')!;
    const fill = () => {
      const field = frame.contentDocument?.querySelector<HTMLInputElement>('#query');
      if (!field) return;
      field.value = button.dataset.query!;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.focus();
    };
    if (frame.contentDocument?.readyState === 'complete') fill();
    else frame.addEventListener('load', fill, { once: true });
  });
});
document.addEventListener('keydown', (event) => {
  if (event.altKey && event.shiftKey && event.code === 'KeyF') { event.preventDefault(); open(); }
});
const params = new URLSearchParams(location.search);
if (params.has('long')) {
  const section = document.createElement('section');
  section.id = 'long-fixture';
  const heading = document.createElement('h2'); heading.textContent = 'Workshop notes'; section.append(heading);
  for (let i = 0; i < 230; i++) {
    const p = document.createElement('p');
    p.textContent = `Workshop note ${i + 1} describes the different colors of our desk accessories.`;
    section.append(p);
  }
  const target = document.createElement('p'); target.id = 'last-sentence';
  target.textContent = 'Visitors who need step-free access can use the wheelchair ramp beside the east entrance.';
  section.append(target);
  document.querySelector('main')!.append(section);
}
Object.assign(window, { semanticFindDemo: { extract: () => new PageIndex(document).extract(), open } });
