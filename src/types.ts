export type { FeedItem, FeedPayload } from '../shared/feed';

export interface Settings {
  /** Leave already-read topics out of the stream (ones read this session stay). */
  hideRead: boolean;
  /** Only show topics newer than this many hours; 0 = everything the relay has. */
  maxAgeHours: number;
  /** Feed relay base URL set on the phone page ('' = build default). */
  feedBase: string;
}

/** A topic kept for later. Stored whole because the feed rolls over within hours. */
export interface SavedItem {
  id: number;
  title: string;
  url: string;
  savedAt: number;
}
