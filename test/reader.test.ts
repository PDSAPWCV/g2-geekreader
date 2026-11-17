import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FeedItem } from '../shared/feed';
import { buildQueue, currentItem, initialState, reseat, step, type ReaderState } from '../src/reader';

const NOW = Date.parse('2026-11-17T12:00:00+09:00');
const mk = (id: number, hoursAgo: number): FeedItem => ({
  id,
  title: `t${id}`,
  url: `https://news.hada.io/topic?id=${id}`,
  author: '',
  published: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  bullets: [],
  truncated: false,
});
const ITEMS = [mk(5, 1), mk(4, 2), mk(3, 10), mk(2, 30), mk(1, 80)];
const pages = (): number => 3;
const at = (index: number, view: ReaderState['view'] = 'browse', page = 0): ReaderState => ({
  queue: ITEMS,
  index,
  view,
  page,
});

test('browse: swipes move between topics and stop at both ends', () => {
  assert.equal(step(at(0), 'swipeDown', pages).state.index, 1);
  assert.equal(step(at(0), 'swipeUp', pages).state.index, 0);
  assert.equal(step(at(4), 'swipeDown', pages).state.index, 5, 'end card');
  assert.equal(step(at(5), 'swipeDown', pages).state.index, 5);
  assert.equal(step(at(5), 'swipeUp', pages).state.index, 4);
});

test('browse: tap opens the summary, double tap exits, long press saves', () => {
  const opened = step(at(1), 'tap', pages);
  assert.deepEqual([opened.state.view, opened.state.page, opened.effect], ['read', 0, 'none']);
  assert.equal(step(at(1), 'doubleTap', pages).effect, 'exit');
  assert.equal(step(at(1), 'longPress', pages).effect, 'toggleSave');
  assert.deepEqual(step(at(1), 'longPressRelease', pages), { state: at(1), effect: 'none' });
});

test('end card: tap asks for new topics, long press does nothing', () => {
  assert.equal(step(at(5), 'tap', pages).effect, 'refresh');
  assert.equal(step(at(5), 'tap', pages).state.view, 'browse');
  assert.equal(step(at(5), 'longPress', pages).effect, 'none');
  assert.equal(step(at(5), 'doubleTap', pages).effect, 'exit');
});

test('read: swipes page through the summary, then on to the next topic', () => {
  assert.equal(step(at(1, 'read', 0), 'swipeDown', pages).state.page, 1);
  const past = step(at(1, 'read', 2), 'swipeDown', pages).state;
  assert.deepEqual([past.view, past.index, past.page], ['browse', 2, 0]);
  assert.equal(step(at(1, 'read', 2), 'swipeUp', pages).state.page, 1);
  const back = step(at(1, 'read', 0), 'swipeUp', pages).state;
  assert.deepEqual([back.view, back.index], ['browse', 1]);
});

test('read: tap goes to the next topic, double tap goes back without exiting', () => {
  const next = step(at(1, 'read', 1), 'tap', pages);
  assert.deepEqual([next.state.view, next.state.index, next.effect], ['browse', 2, 'none']);
  const back = step(at(1, 'read', 1), 'doubleTap', pages);
  assert.deepEqual([back.state.view, back.state.index, back.effect], ['browse', 1, 'none']);
  assert.equal(step(at(1, 'read', 1), 'longPress', pages).effect, 'toggleSave');
  const last = step(at(4, 'read', 0), 'tap', pages).state;
  assert.equal(last.index, 5, 'tap on the last topic lands on the end card');
});

test('buildQueue applies the age limit, hides read topics, keeps session topics', () => {
  const ids = (q: FeedItem[]) => q.map((i) => i.id);
  const base = { isRead: (id: number) => id === 4, now: NOW, keep: new Set<number>() };
  assert.deepEqual(ids(buildQueue(ITEMS, { ...base, hideRead: true, maxAgeHours: 24 })), [5, 3]);
  assert.deepEqual(ids(buildQueue(ITEMS, { ...base, hideRead: false, maxAgeHours: 24 })), [5, 4, 3]);
  assert.deepEqual(ids(buildQueue(ITEMS, { ...base, hideRead: true, maxAgeHours: 72 })), [5, 3, 2]);
  assert.deepEqual(ids(buildQueue(ITEMS, { ...base, hideRead: true, maxAgeHours: 0 })), [5, 3, 2, 1]);
  assert.deepEqual(
    ids(buildQueue(ITEMS, { ...base, hideRead: true, maxAgeHours: 24, keep: new Set([4, 1]) })),
    [5, 4, 3, 1],
  );
});

test('reseat keeps the topic on screen when the queue changes around it', () => {
  const first = reseat(initialState(), ITEMS.slice(2));
  assert.equal(first.index, 0, 'first load starts at the top');

  const reading: ReaderState = { queue: ITEMS.slice(2), index: 1, view: 'read', page: 2 };
  const grown = reseat(reading, ITEMS);
  assert.deepEqual([currentItem(grown)?.id, grown.index, grown.view, grown.page], [2, 3, 'read', 2]);

  assert.equal(reseat(reading, ITEMS, true).index, 0);
  assert.equal(reseat(reading, ITEMS, true).view, 'browse');

  const atEnd: ReaderState = { queue: ITEMS.slice(2), index: 3, view: 'browse', page: 0 };
  assert.equal(reseat(atEnd, ITEMS).index, ITEMS.length, 'stays on the end card');

  const gone = reseat(reading, [ITEMS[0]]);
  assert.deepEqual([gone.index, gone.view], [1, 'browse'], 'topic vanished → clamp, back to browse');
});
