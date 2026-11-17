// Client side of the feed: asks the relay (`GET <base>/items`) for parsed topics, merges
// them into a local cache so the app opens instantly and keeps topics the relay has
// already dropped, and reports a status the lens and the phone page can show.

import { isFeedItem, mergeItems, sortItems, type FeedItem } from '../shared/feed';
import { getSettings } from './store';
import { log } from './log';
import { mockItems } from './mock';
import { isMock, isReset, param } from './params';

const CACHE_KEY = 'geekreader.items.v1';
const FETCH_TIMEOUT = 15_000;
/** Opening the app or returning to it re-reads the feed only when the copy is older. */
export const STALE_MS = 10 * 60_000;

export type FeedStatus = 'idle' | 'loading' | 'ok' | 'error' | 'unconfigured';

export interface FeedState {
  items: FeedItem[];
  status: FeedStatus;
  /** Last failure, for the phone page and the lens. */
  error: string;
  /** When this device last got a good answer from the relay (ms), 0 = never. */
  fetchedAt: number;
}

/** Relay base, first match wins: `?feed=` > phone page setting > VITE_FEED_BASE >
 * `/api` on the Vite dev server (vite.config.ts) > none. */
export function feedBase(): string {
  const base =
    param('feed') ||
    getSettings().feedBase ||
    (import.meta.env.VITE_FEED_BASE as string | undefined) ||
    (import.meta.env.DEV ? '/api' : '');
  return base.trim().replace(/\/+$/, '');
}

function loadCache(): { items: FeedItem[]; fetchedAt: number } {
  try {
    if (isReset) localStorage.removeItem(CACHE_KEY);
    const o = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as { items?: unknown; fetchedAt?: unknown };
    const items = Array.isArray(o.items) ? o.items.filter(isFeedItem) : [];
    return { items: sortItems(items), fetchedAt: typeof o.fetchedAt === 'number' ? o.fetchedAt : 0 };
  } catch {
    return { items: [], fetchedAt: 0 };
  }
}

const cached = isMock ? { items: mockItems(), fetchedAt: Date.now() } : loadCache();
// A cached copy counts as a good answer: when it is still fresh nothing is fetched, and
// the lens must not sit on "loading" because every cached topic happens to be read.
let state: FeedState = { ...cached, status: cached.fetchedAt ? 'ok' : 'idle', error: '' };
const subs = new Set<() => void>();

export const getFeed = (): FeedState => state;

export function subscribeFeed(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

function set(patch: Partial<FeedState>): void {
  state = { ...state, ...patch };
  subs.forEach((s) => s());
}

let inFlight: Promise<void> | null = null;

/** Read the relay. Without `force`, does nothing while the local copy is fresh. */
export function refreshFeed(force = false): Promise<void> {
  if (isMock) return Promise.resolve();
  if (inFlight) return inFlight;
  if (!force && state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return Promise.resolve();
  const base = feedBase();
  if (!base) {
    set({ status: 'unconfigured', error: '' });
    return Promise.resolve();
  }
  set({ status: 'loading', error: '' });
  inFlight = (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    try {
      const r = await fetch(`${base}/items`, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { items?: unknown };
      if (!Array.isArray(body.items)) throw new Error('unexpected response');
      const items = mergeItems(state.items, body.items.filter(isFeedItem));
      const fetchedAt = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ items, fetchedAt }));
      } catch {
        /* quota — keep in memory */
      }
      log(`feed ok: ${body.items.length} from relay, ${items.length} kept`);
      set({ items, fetchedAt, status: 'ok', error: '' });
    } catch (e) {
      const msg = ctl.signal.aborted ? 'timeout' : e instanceof Error ? e.message : String(e);
      log(`feed failed: ${msg} (${base}/items)`, 'error');
      set({ status: 'error', error: msg });
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  })();
  return inFlight;
}
