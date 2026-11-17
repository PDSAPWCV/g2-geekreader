// Feed relay for GeekReader KR.
//
// Why it exists: the GeekNews feed has no CORS headers, so the app's WebView cannot read
// it directly, and the feed only lists the latest 20 topics (about half a day). This
// Worker reads the feed every 30 minutes, keeps the last MAX_ITEMS topics in KV and
// serves them as JSON.
//
// It reads ONLY the public feed (https://news.hada.io/rss/news). It never requests
// topic pages, comments or any other page of the site.

import {
  FEED_URL,
  FEED_USER_AGENT,
  isFeedItem,
  mergeItems,
  parseFeed,
  sortItems,
  type FeedPayload,
} from '../../shared/feed';

interface Env {
  FEED: KVNamespace;
}

const KEY = 'items.v1';
// The cron runs every 30 minutes; a request only reads the feed itself when the stored
// copy is older than this (first request after deploy, or a missed cron run).
const STALE_MS = 35 * 60_000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

async function load(env: Env): Promise<FeedPayload> {
  const v = await env.FEED.get<{ items?: unknown; fetchedAt?: unknown }>(KEY, 'json');
  return {
    items: Array.isArray(v?.items) ? sortItems(v.items.filter(isFeedItem)) : [],
    fetchedAt: typeof v?.fetchedAt === 'number' ? v.fetchedAt : 0,
  };
}

async function refresh(env: Env, old?: FeedPayload): Promise<FeedPayload> {
  const prev = old ?? (await load(env));
  const r = await fetch(FEED_URL, {
    headers: { 'user-agent': FEED_USER_AGENT, accept: 'application/atom+xml, application/xml' },
  });
  if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
  const fresh = parseFeed(await r.text());
  if (!fresh.length) throw new Error('feed had no entries');
  const payload: FeedPayload = { items: mergeItems(prev.items, fresh), fetchedAt: Date.now() };
  await env.FEED.put(KEY, JSON.stringify(payload));
  return payload;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'method not allowed' }, 405);

    const { pathname } = new URL(req.url);
    if (pathname === '/health') return json({ ok: true });
    if (pathname !== '/items') return json({ error: 'not found' }, 404);

    let payload = await load(env);
    if (Date.now() - payload.fetchedAt > STALE_MS) {
      try {
        payload = await refresh(env, payload);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`refresh failed: ${error}`);
        // An older copy is still worth serving; with nothing stored, say why.
        if (!payload.items.length) return json({ error }, 502);
      }
    }
    return json(payload, 200, { 'cache-control': 'public, max-age=300' });
  },

  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      refresh(env).then(
        (p) => console.log(`feed refreshed: ${p.items.length} topics kept`),
        (e) => console.error(`scheduled refresh failed: ${e instanceof Error ? e.message : String(e)}`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
