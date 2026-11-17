// Phone page (what the Even app shows when the plugin is opened) + app start-up.
// Feed text is only ever put into the DOM with textContent, never as HTML.

import { applyGesture, initController, lensPreview, readerPosition, subscribeLens } from './controller';
import { feedBase, getFeed, refreshFeed, subscribeFeed } from './feed';
import type { InputGesture } from './gestures';
import { ago } from './layout';
import { clearLog, logEntries, mirrorConsole, onLog } from './log';
import { isDebug, isMock, param } from './params';
import {
  clearRead,
  getSaved,
  getSettings,
  isRead,
  removeSaved,
  restoreStore,
  setSettings,
  subscribeStore,
} from './store';

mirrorConsole();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function topicLink(title: string, url: string): HTMLAnchorElement {
  // Only topic pages on news.hada.io are ever linked.
  const safe = /^https:\/\/news\.hada\.io\/topic\?id=\d+$/.test(url) ? url : 'https://news.hada.io/';
  return el('a', { href: safe, target: '_blank', rel: 'noopener noreferrer', textContent: title });
}

const hhmm = (t: number): string =>
  new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

// ── status chip ──────────────────────────────────────────────────────────────
function renderStatus(): void {
  const f = getFeed();
  const chip = $('status');
  chip.dataset.state = f.status;
  if (isMock) chip.textContent = '데모 모드';
  else if (f.status === 'loading') chip.textContent = '불러오는 중';
  else if (f.status === 'error') chip.textContent = `오류: ${f.error}`;
  else if (f.status === 'unconfigured') chip.textContent = '피드 서버 주소 필요';
  else chip.textContent = f.fetchedAt ? `${hhmm(f.fetchedAt)} 갱신` : '준비 중';

  $('feed-info').textContent =
    `피드 서버: ${isMock ? '(데모 모드)' : feedBase() || '(없음)'} · 받아 둔 글 ${f.items.length}개` +
    (f.error ? ` · 마지막 오류: ${f.error}` : '');
}

// ── lens preview ─────────────────────────────────────────────────────────────
function renderLens(): void {
  $('lens').replaceChildren(
    ...lensPreview().map((r) => {
      const row = el('div', { className: 'lens-row', textContent: r.text || ' ' });
      row.dataset.color = String(r.color);
      return row;
    }),
  );
}

// ── saved ────────────────────────────────────────────────────────────────────
function renderSaved(): void {
  const saved = getSaved();
  $('saved-count').textContent = saved.length ? `${saved.length}개` : '';
  if (!saved.length) {
    $('saved').replaceChildren(
      el('li', { className: 'empty', textContent: '안경에서 길게 누르면 그 글이 여기에 저장됩니다.' }),
    );
    return;
  }
  // Scrolls inside its own window: deleting one entry must not jump back to the top.
  const list = $('saved');
  const top = list.scrollTop;
  list.replaceChildren(
    ...saved.map((s) => {
      const remove = el('button', { type: 'button', textContent: '삭제' });
      remove.addEventListener('click', () => removeSaved(s.id));
      return el('li', {}, [el('div', { className: 'grow' }, [topicLink(s.title, s.url)]), remove]);
    }),
  );
  list.scrollTop = top;
}

// ── topic list ───────────────────────────────────────────────────────────────
function renderItems(): void {
  const { maxAgeHours } = getSettings();
  const now = Date.now();
  const oldest = maxAgeHours > 0 ? now - maxAgeHours * 3_600_000 : -Infinity;
  const items = getFeed().items.filter((it) => (Date.parse(it.published) || 0) >= oldest);
  const unread = items.filter((it) => !isRead(it.id)).length;
  $('list-count').textContent = items.length ? `${items.length}개 · 안 읽음 ${unread}` : '';
  if (!items.length) {
    $('items').replaceChildren(el('li', { className: 'empty', textContent: '아직 받아 온 글이 없습니다.' }));
    return;
  }
  const cur = readerPosition().id;
  // The list scrolls inside its own window; redrawing must not move what is being read.
  const list = $('items');
  const top = list.scrollTop;
  list.replaceChildren(
    ...items.map((it) => {
      const meta = [ago(it.published, now), it.author, isRead(it.id) ? '읽음' : ''].filter(Boolean).join(' · ');
      const li = el('li', {}, [
        el('div', { className: 'grow' }, [topicLink(it.title, it.url), el('div', { className: 'meta', textContent: meta })]),
      ]);
      if (isRead(it.id)) li.classList.add('read');
      if (it.id === cur) li.classList.add('current');
      return li;
    }),
  );
  list.scrollTop = top;
}

// ── settings ─────────────────────────────────────────────────────────────────
function renderSettings(): void {
  const s = getSettings();
  $<HTMLInputElement>('hide-read').checked = s.hideRead;
  $<HTMLSelectElement>('max-age').value = String(s.maxAgeHours);
  const base = $<HTMLInputElement>('feed-base');
  if (document.activeElement !== base) base.value = s.feedBase;
  const read = getFeed().items.filter((it) => isRead(it.id)).length;
  $('read-count').textContent = read ? `받아 둔 글 중 ${read}개 읽음` : '';
}

function renderLog(): void {
  const pre = $('log');
  pre.replaceChildren(
    ...logEntries()
      .slice(-120)
      .map((l) => el('div', { className: l.level, textContent: `${hhmm(l.at)} ${l.text}` })),
  );
  pre.scrollTop = pre.scrollHeight;
}

function renderAll(): void {
  renderStatus();
  renderLens();
  renderSaved();
  renderItems();
  renderSettings();
}

// ── wiring ───────────────────────────────────────────────────────────────────
$<HTMLInputElement>('hide-read').addEventListener('change', (e) =>
  setSettings({ hideRead: (e.target as HTMLInputElement).checked }),
);
$<HTMLSelectElement>('max-age').addEventListener('change', (e) =>
  setSettings({ maxAgeHours: Number((e.target as HTMLSelectElement).value) || 0 }),
);
$('clear-read').addEventListener('click', () => clearRead());
$('refresh').addEventListener('click', () => void refreshFeed(true));
$('feed-base-save').addEventListener('click', () => {
  setSettings({ feedBase: $<HTMLInputElement>('feed-base').value.trim() });
  void refreshFeed(true);
});
$('log-clear').addEventListener('click', () => clearLog());
document.querySelectorAll<HTMLButtonElement>('[data-gesture]').forEach((b) =>
  b.addEventListener('click', () => applyGesture(b.dataset.gesture as InputGesture)),
);

subscribeFeed(renderAll);
subscribeStore(renderAll);
subscribeLens(() => {
  renderLens();
  renderItems();
});
onLog(renderLog);

// ?debug=1: follow "go to this URL" commands from the dev server (vite.config.ts,
// /__dev/goto), so one simulator window can be steered between demo data, the real
// feed and the built app instead of being relaunched. The built app has no dev server
// of its own and is told where to listen with ?ctl=http://localhost:5175.
if (isDebug) {
  const ctl = param('ctl') || (import.meta.env.DEV ? location.origin : '');
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(ctl)) {
    new EventSource(`${ctl}/__dev/events`).onmessage = (e) => {
      try {
        const { url } = JSON.parse(String(e.data)) as { url?: unknown };
        if (typeof url === 'string') location.href = new URL(url, ctl).href;
      } catch {
        /* not a command */
      }
    };
  }
}

// The bridge KVS restore must not hold up the first draw: in a plain browser there is
// no bridge to answer. If it does bring settings back, the store notifies everyone.
void restoreStore();
initController();
renderAll();
renderLog();
