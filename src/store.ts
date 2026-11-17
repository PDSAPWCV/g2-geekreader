// Everything the app remembers: settings, which topics were read, which were saved.
// One JSON blob in localStorage, mirrored to the Even bridge KVS because Android may
// discard the WebView's storage.

import { bridge } from './bridge';
import { isReset } from './params';
import type { FeedItem, SavedItem, Settings } from './types';

const KEY = 'geekreader.state.v1';
const MAX_READ = 1500; // topic ids remembered as read (the relay keeps 150)
const MIRROR_DELAY = 1500; // ms — reading marks arrive in bursts while swiping

const DEFAULT_SETTINGS: Settings = { hideRead: true, maxAgeHours: 24, feedBase: '' };

interface Persisted {
  settings: Settings;
  read: number[];
  saved: SavedItem[];
}

export type StoreChange = 'settings' | 'read' | 'saved';

function parse(raw: string | null | undefined): Persisted {
  let o: Partial<Persisted> = {};
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    if (v && typeof v === 'object') o = v as Partial<Persisted>;
  } catch {
    /* corrupt blob → defaults */
  }
  const saved = Array.isArray(o.saved)
    ? o.saved.filter(
        (s): s is SavedItem =>
          !!s && Number.isSafeInteger(s.id) && typeof s.title === 'string' && typeof s.url === 'string',
      )
    : [];
  return {
    // Spreading defaults first lets older blobs pick up settings added later.
    settings: { ...DEFAULT_SETTINGS, ...(o.settings && typeof o.settings === 'object' ? o.settings : {}) },
    read: Array.isArray(o.read) ? o.read.filter((n) => Number.isSafeInteger(n)) : [],
    saved,
  };
}

function loadLocal(): Persisted {
  try {
    if (isReset) localStorage.removeItem(KEY);
    return parse(localStorage.getItem(KEY));
  } catch {
    return parse(null);
  }
}

let data = loadLocal();
let readSet = new Set(data.read);
const subs = new Set<(change: StoreChange) => void>();
let mirrorTimer: ReturnType<typeof setTimeout> | null = null;

function persist(change: StoreChange): void {
  const json = JSON.stringify(data);
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* private mode / quota — keep in memory */
  }
  if (mirrorTimer) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    void bridge()
      .then((b) => b.setLocalStorage(KEY, JSON.stringify(data)))
      .catch(() => {});
  }, MIRROR_DELAY);
  subs.forEach((s) => s(change));
}

export function subscribeStore(cb: (change: StoreChange) => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

// ── settings ─────────────────────────────────────────────────────────────────
export const getSettings = (): Settings => data.settings;

export function setSettings(patch: Partial<Settings>): void {
  data = { ...data, settings: { ...data.settings, ...patch } };
  persist('settings');
}

// ── read marks ───────────────────────────────────────────────────────────────
export const isRead = (id: number): boolean => readSet.has(id);

export function markRead(id: number): void {
  if (readSet.has(id)) return;
  readSet.add(id);
  const read = [...data.read, id];
  data = { ...data, read: read.length > MAX_READ ? read.slice(read.length - MAX_READ) : read };
  if (read.length > MAX_READ) readSet = new Set(data.read);
  persist('read');
}

export function clearRead(): void {
  if (!data.read.length) return;
  data = { ...data, read: [] };
  readSet = new Set();
  persist('read');
}

// ── saved for later ──────────────────────────────────────────────────────────
export const getSaved = (): readonly SavedItem[] => data.saved;
export const isSaved = (id: number): boolean => data.saved.some((s) => s.id === id);

/** Returns true when the topic is saved after the call. */
export function toggleSaved(item: Pick<FeedItem, 'id' | 'title' | 'url'>): boolean {
  const had = isSaved(item.id);
  data = {
    ...data,
    saved: had
      ? data.saved.filter((s) => s.id !== item.id)
      : [{ id: item.id, title: item.title, url: item.url, savedAt: Date.now() }, ...data.saved],
  };
  persist('saved');
  return !had;
}

export function removeSaved(id: number): void {
  if (!isSaved(id)) return;
  data = { ...data, saved: data.saved.filter((s) => s.id !== id) };
  persist('saved');
}

/** If localStorage was wiped (app update / WebView reset), pull the blob back from the
 * bridge KVS. Call once at startup; a no-op when localStorage already has a copy. */
export async function restoreStore(): Promise<void> {
  if (isReset) {
    // ?reset=1: overwrite the mirror too, or the old blob would come straight back.
    void bridge()
      .then((b) => b.setLocalStorage(KEY, JSON.stringify(data)))
      .catch(() => {});
    return;
  }
  try {
    if (localStorage.getItem(KEY)) return;
  } catch {
    /* fall through */
  }
  try {
    const b = await bridge();
    const raw = await b.getLocalStorage(KEY);
    if (!raw) return;
    data = parse(raw);
    readSet = new Set(data.read);
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      /* ignore */
    }
    (['settings', 'read', 'saved'] as const).forEach((c) => subs.forEach((s) => s(c)));
  } catch {
    /* no bridge (plain browser) — keep what we have */
  }
}
