// The reader as a pure state machine: no bridge, no storage, no clock of its own, so
// every gesture binding can be tested (test/reader.test.ts). controller.ts owns the
// single live state and carries out the effects.
//
//   browse  one topic per screen (title + start of summary)
//   read    the whole feed summary of that topic, paged
//
// | gesture    | browse                    | read                                     |
// |------------|---------------------------|------------------------------------------|
// | swipe down | next topic                | next page; past the last page: next topic |
// | swipe up   | previous topic            | previous page; before the first: its card |
// | tap        | read (end card: refresh)  | next topic                               |
// | double tap | exit the app              | back to its card                         |
// | long press | save / unsave             | save / unsave                            |
//
// Root double-tap is the platform's app-exit gesture, so it is only "back" one level in.

import type { FeedItem } from '../shared/feed';
import type { InputGesture } from './gestures';

export interface ReaderState {
  /** Topics of this session, newest first. */
  queue: FeedItem[];
  /** 0..queue.length; queue.length is the end card. */
  index: number;
  view: 'browse' | 'read';
  /** Page within the summary (read view). */
  page: number;
}

export type Effect = 'none' | 'exit' | 'refresh' | 'toggleSave';

export const initialState = (): ReaderState => ({ queue: [], index: 0, view: 'browse', page: 0 });

export const currentItem = (s: ReaderState): FeedItem | null => s.queue[s.index] ?? null;

export function step(
  s: ReaderState,
  g: InputGesture,
  pageCount: (item: FeedItem) => number,
): { state: ReaderState; effect: Effect } {
  const item = currentItem(s);
  const card = (index: number): ReaderState => ({
    ...s,
    view: 'browse',
    page: 0,
    index: Math.max(0, Math.min(s.queue.length, index)),
  });
  const to = (state: ReaderState, effect: Effect = 'none') => ({ state, effect });

  if (g === 'longPressRelease') return to(s);
  if (g === 'longPress') return to(s, item ? 'toggleSave' : 'none');

  if (s.view === 'read' && item) {
    switch (g) {
      case 'swipeDown':
        return to(s.page < pageCount(item) - 1 ? { ...s, page: s.page + 1 } : card(s.index + 1));
      case 'swipeUp':
        return to(s.page > 0 ? { ...s, page: s.page - 1 } : card(s.index));
      case 'tap':
        return to(card(s.index + 1));
      case 'doubleTap':
        return to(card(s.index));
    }
  }

  switch (g) {
    case 'swipeDown':
      return to(card(s.index + 1));
    case 'swipeUp':
      return to(card(s.index - 1));
    case 'tap':
      return item ? to({ ...s, view: 'read', page: 0 }) : to(card(s.index), 'refresh');
    case 'doubleTap':
      return to(card(s.index), 'exit');
  }
}

export interface QueueOptions {
  isRead: (id: number) => boolean;
  hideRead: boolean;
  /** 0 = no age limit. */
  maxAgeHours: number;
  now: number;
  /** Topics already shown this session: kept even once read or past the age limit. */
  keep: ReadonlySet<number>;
}

/** Which topics the stream shows, newest first (`items` must already be sorted). */
export function buildQueue(items: FeedItem[], o: QueueOptions): FeedItem[] {
  const oldest = o.maxAgeHours > 0 ? o.now - o.maxAgeHours * 3_600_000 : -Infinity;
  return items.filter((it) => {
    if (o.keep.has(it.id)) return true;
    if (o.hideRead && o.isRead(it.id)) return false;
    return (Date.parse(it.published) || 0) >= oldest;
  });
}

/** Swap in a rebuilt queue without moving the reader off the topic being shown. */
export function reseat(prev: ReaderState, queue: FeedItem[], toTop = false): ReaderState {
  if (toTop) return { queue, index: 0, view: 'browse', page: 0 };
  const cur = currentItem(prev);
  if (!cur) {
    // Nothing was loaded yet → start at the top; otherwise stay on the end card.
    return { queue, index: prev.queue.length ? queue.length : 0, view: 'browse', page: 0 };
  }
  const at = queue.findIndex((it) => it.id === cur.id);
  if (at >= 0) return { ...prev, queue, index: at };
  return { queue, index: Math.min(prev.index, queue.length), view: 'browse', page: 0 };
}
