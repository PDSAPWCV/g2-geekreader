// Glasses controller: owns the reader state, decides what the lens shows (lens.ts draws
// it) and turns touch events into reader.ts gestures.

import type { EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { bridge } from './bridge';
import { getFeed, refreshFeed, subscribeFeed } from './feed';
import { toGesture, type InputGesture } from './gestures';
import { cardRows, messageRows, readPages, readRows, type Row } from './layout';
import { Lens } from './lens';
import { log } from './log';
import { buildQueue, currentItem, initialState, reseat, step, type ReaderState } from './reader';
import { getSettings, isRead, isSaved, markRead, subscribeStore, toggleSaved } from './store';

const APP_TITLE = 'GeekReader KR';

// ── reader state ─────────────────────────────────────────────────────────────
let state: ReaderState = initialState();
/** Topics shown this session: they stay in the stream after being marked read. */
const sessionIds = new Set<number>();
/** No touch yet since the app came to the foreground: new topics may still move the
 * reader to the top. After the first touch the topic on screen stays put. */
let interacted = false;
/** The end card asked for new topics and is waiting for the answer. */
let awaitingRefresh = false;
let endNote = '';

/** Rebuild the stream from the feed cache. Returns how many topics are new to it. */
function syncQueue(): number {
  const s = getSettings();
  const queue = buildQueue(getFeed().items, {
    isRead,
    hideRead: s.hideRead,
    maxAgeHours: s.maxAgeHours,
    now: Date.now(),
    keep: sessionIds,
  });
  let fresh = 0;
  for (const it of queue) {
    if (!sessionIds.has(it.id)) {
      sessionIds.add(it.id);
      fresh++;
    }
  }
  state = reseat(state, queue);
  return fresh;
}

function onFeed(): void {
  const fresh = syncQueue();
  const status = getFeed().status;
  if (fresh > 0 && (!interacted || awaitingRefresh)) state = reseat(state, state.queue, true);
  if (awaitingRefresh && status !== 'loading') {
    awaitingRefresh = false;
    endNote = fresh > 0 || status === 'error' ? '' : '새 글이 없습니다';
  }
  changed();
}

function onSettings(): void {
  // Range / hide-read changed on the phone: drop the session's "keep" list so the new
  // filter applies, but hold on to the topic being shown.
  const cur = currentItem(state);
  sessionIds.clear();
  if (cur) sessionIds.add(cur.id);
  syncQueue();
  changed();
}

// ── what to draw ─────────────────────────────────────────────────────────────
function lensRows(): Row[] {
  const item = currentItem(state);
  const total = state.queue.length;
  if (item) {
    const pos = state.index + 1;
    return state.view === 'read'
      ? readRows(item, state.page, pos, total, isSaved(item.id))
      : cardRows(item, pos, total, isSaved(item.id), Date.now());
  }
  const feed = getFeed();
  const failure = feed.status === 'error' ? `피드 오류: ${feed.error}` : '';
  if (total > 0) {
    return messageRows(`${total}개를 모두 봤습니다`, [
      feed.status === 'loading' ? '새 글 확인 중…' : failure || endNote,
      '',
      '탭: 새 글 확인',
      '위로 쓸기: 이전 글',
      '두 번 탭: 종료',
    ]);
  }
  switch (feed.status) {
    case 'idle':
    case 'loading':
      return messageRows(APP_TITLE, ['글을 불러오는 중…']);
    case 'unconfigured':
      return messageRows(APP_TITLE, ['피드 서버 주소가 없습니다', '폰 화면의 개발용 칸에 주소를 입력하세요']);
    case 'error':
      return messageRows(APP_TITLE, ['피드를 불러오지 못했습니다', feed.error, '', '탭: 다시 시도']);
    default:
      return messageRows(APP_TITLE, [
        '새 글이 없습니다',
        getSettings().hideRead ? '읽은 글은 폰 화면의 목록에서 볼 수 있습니다' : '',
        '',
        '탭: 새 글 확인',
      ]);
  }
}

const lens = new Lens(() => lensRows());

const lensSubs = new Set<() => void>();
/** Notified whenever what the lens shows may have changed (for the phone preview). */
export function subscribeLens(cb: () => void): () => void {
  lensSubs.add(cb);
  return () => lensSubs.delete(cb);
}

function changed(): void {
  lens.update();
  lensSubs.forEach((f) => f());
}

/** What the lens shows right now. Computed directly, so it also works in a plain
 * browser without the Even bridge. */
export const lensPreview = (): Row[] => lensRows();

/** Where the reader is, for the phone page. */
export const readerPosition = (): { id: number | null; view: ReaderState['view'] } => ({
  id: currentItem(state)?.id ?? null,
  view: state.view,
});

// ── input ────────────────────────────────────────────────────────────────────
/** Swipes closer together than this are one swipe. */
const SWIPE_GAP_MS = 300;
/** Swipes this soon after a row was sent are the re-layout's echo, not the wearer. */
const DRAW_ECHO_MS = 140;
/** A tap this soon after a long press is part of it (some inputs report one on release)
 * and must not open the topic that was just saved. */
const PRESS_TAP_MS = 500;
let lastSwipeAt = 0;
let lastPressAt = 0;

/** Drop the touches that are artefacts of the hardware rather than intent. */
function accept(g: InputGesture, now: number): boolean {
  switch (g) {
    case 'longPress':
    case 'longPressRelease':
      lastPressAt = now;
      return true;
    case 'tap':
      return now - lastPressAt >= PRESS_TAP_MS;
    case 'swipeUp':
    case 'swipeDown':
      if (now - lens.lastSentAt < DRAW_ECHO_MS || now - lastSwipeAt < SWIPE_GAP_MS) return false;
      lastSwipeAt = now;
      return true;
    default:
      return true;
  }
}

const pageCount = (item: Parameters<typeof readPages>[0]): number => readPages(item).length;

/** Apply one gesture to the reader. Also called by the phone page's gesture buttons. */
export function applyGesture(g: InputGesture): void {
  // A topic counts as read once the wearer has touched anything while it was on screen
  // (so one that merely loaded while the glasses were idle stays unread).
  const before = currentItem(state);
  if (before) markRead(before.id);
  interacted = true;
  endNote = '';

  const { state: next, effect } = step(state, g, pageCount);
  state = next;
  const item = currentItem(state);
  if (item) markRead(item.id);

  switch (effect) {
    case 'toggleSave':
      if (item) log(`${toggleSaved(item) ? 'saved' : 'unsaved'} topic ${item.id}`);
      break;
    case 'refresh':
      awaitingRefresh = true;
      // The feed store normally answers through onFeed(); the extra call covers the
      // cases where it has nothing to announce (demo mode).
      void refreshFeed(true).then(() => {
        if (awaitingRefresh) onFeed();
      });
      break;
    case 'exit':
      exitApp();
      return;
    case 'none':
      break;
  }
  changed();
}

function onEvent(ev: EvenHubEvent): void {
  const gesture = toGesture(ev);
  const channel = (c?: { eventType?: unknown }): string => (c ? String(c.eventType ?? 'click') : '-');
  log(`ev ${gesture ?? '?'} list=${channel(ev.listEvent)} text=${channel(ev.textEvent)} sys=${channel(ev.sysEvent)}`);
  switch (gesture) {
    case null:
      return;
    case 'foregroundEnter':
      // Back on the glasses: a fresh page, and new topics may move the reader again.
      lens.resume();
      interacted = false;
      void refreshFeed(); // re-reads only when the local copy is stale
      changed();
      return;
    case 'foregroundExit':
      log('left the glasses');
      lens.suspend();
      return;
    default:
      if (accept(gesture, Date.now())) applyGesture(gesture);
  }
}

/** Double tap on the stream: stop drawing and ask the host to close the app. Mode 1 goes
 * through the host's exit screen; mode 0 would end the app at once. */
function exitApp(): void {
  log('closing: shutDownPageContainer(1)');
  lens.suspend();
  bridge()
    .then((b) => b.shutDownPageContainer(1))
    .catch((e) => log(`shutDownPageContainer failed: ${e instanceof Error ? e.message : String(e)}`, 'warn'));
}

let initDone = false;

export function initController(): void {
  if (initDone) return;
  initDone = true;
  syncQueue();
  subscribeFeed(onFeed);
  subscribeStore((change) => {
    if (change === 'settings') onSettings();
    else if (change === 'saved') changed();
  });
  lens.update();
  void bridge().then((b) => b.onEvenHubEvent(onEvent));
  void refreshFeed();
}
