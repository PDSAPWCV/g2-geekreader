// GeekNews Atom feed → plain items. Pure TypeScript with no DOM, so the same code runs
// in the Cloudflare Worker, in the Vite dev middleware and in tests.
//
// The feed is the only source this app reads. It carries, per topic, the title and the
// first ~300 characters of the Korean summary (cut with a trailing "…"); it has no
// comments and no full body.

export const FEED_URL = 'https://news.hada.io/rss/news';
export const FEED_USER_AGENT = 'GeekReaderKR/0.1 (personal feed reader)';
/** How many items a relay keeps (the feed itself only lists the latest 20). */
export const MAX_ITEMS = 150;

export interface FeedItem {
  /** GeekNews topic id. */
  id: number;
  title: string;
  /** Canonical topic page, built from the id (never taken verbatim from the feed). */
  url: string;
  author: string;
  /** ISO 8601 with offset, as given by the feed. */
  published: string;
  /** Summary as plain-text blocks (one per bullet or paragraph). */
  bullets: string[];
  /** The feed cut the summary short. */
  truncated: boolean;
}

export interface FeedPayload {
  items: FeedItem[];
  /** When the relay last read the feed (ms since epoch). */
  fetchedAt: number;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  middot: '·',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  rarr: '→',
  larr: '←',
};

/** Decode HTML/XML entities in one pass (so `&amp;lt;` becomes `&lt;`, not `<`). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const cp = parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text of an XML element: CDATA is taken as is, anything else is entity-decoded. */
function xmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return cdata ? cdata[1] : decodeEntities(raw);
}

function element(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? m[1] : null;
}

const BLOCK_TAG = /<\/?(?:li|p|div|ul|ol|br|h[1-6]|blockquote|pre|tr|hr)\b[^>]*>/gi;
const ELLIPSIS_ONLY = /^(?:…|\.{3})$/;
const ELLIPSIS_END = /(?:…|\.{3})$/;

/** Summary HTML → plain-text blocks, plus whether the feed cut it short. */
export function htmlToBullets(html: string): { bullets: string[]; truncated: boolean } {
  const text = decodeEntities(html.replace(BLOCK_TAG, '\n').replace(/<[^>]*>/g, ''));
  const bullets = text
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  let truncated = false;
  // The feed appends a bare "…" after the closing tags when it cuts the summary.
  if (bullets.length && ELLIPSIS_ONLY.test(bullets[bullets.length - 1])) {
    bullets.pop();
    truncated = true;
  } else if (bullets.length && ELLIPSIS_END.test(bullets[bullets.length - 1])) {
    truncated = true;
  }
  if (truncated && bullets.length && !ELLIPSIS_END.test(bullets[bullets.length - 1])) {
    bullets[bullets.length - 1] += '…';
  }
  return { bullets, truncated };
}

function topicId(entry: string): number | null {
  const href = /<link\b[^>]*\bhref=(['"])(.*?)\1/i.exec(entry)?.[2] ?? '';
  const fromLink = /[?&]id=(\d+)/.exec(decodeEntities(href));
  const fromId = /[?&]id=(\d+)/.exec(xmlText(element(entry, 'id') ?? ''));
  const n = Number((fromLink ?? fromId)?.[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Parse the Atom document. Entries without a topic id or title are skipped. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const entry = m[1];
    const id = topicId(entry);
    const title = xmlText(element(entry, 'title') ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (id == null || !title) continue;
    const published = xmlText(element(entry, 'published') ?? element(entry, 'updated') ?? '').trim();
    const author = xmlText(element(element(entry, 'author') ?? '', 'name') ?? '').trim();
    const { bullets, truncated } = htmlToBullets(xmlText(element(entry, 'content') ?? element(entry, 'summary') ?? ''));
    items.push({
      id,
      title,
      url: `https://news.hada.io/topic?id=${id}`,
      author,
      published: Number.isFinite(Date.parse(published)) ? published : '',
      bullets,
      truncated,
    });
  }
  return items;
}

const time = (it: FeedItem): number => Date.parse(it.published) || 0;

/** Newest first; ties broken by the larger topic id. */
export function sortItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => time(b) - time(a) || b.id - a.id);
}

/** Union by topic id (fresh wins), newest first, capped at `max`. */
export function mergeItems(old: FeedItem[], fresh: FeedItem[], max = MAX_ITEMS): FeedItem[] {
  const byId = new Map<number, FeedItem>();
  for (const it of old) byId.set(it.id, it);
  for (const it of fresh) byId.set(it.id, it);
  return sortItems([...byId.values()]).slice(0, max);
}

/** Loose runtime check for data that came over the network or out of storage. */
export function isFeedItem(x: unknown): x is FeedItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    Number.isSafeInteger(o.id) &&
    typeof o.title === 'string' &&
    typeof o.url === 'string' &&
    typeof o.author === 'string' &&
    typeof o.published === 'string' &&
    Array.isArray(o.bullets) &&
    o.bullets.every((b) => typeof b === 'string') &&
    typeof o.truncated === 'boolean'
  );
}
