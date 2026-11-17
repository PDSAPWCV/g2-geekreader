import type { ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { FEED_URL, FEED_USER_AGENT, mergeItems, parseFeed, type FeedPayload } from './shared/feed.ts';

// 개발 서버에서만 쓰는 피드 중계. 실제 배포에서는 worker/가 같은 응답(`GET /items`)을 준다.
// 피드에는 CORS 헤더가 없어서 브라우저(WebView)가 직접 읽을 수 없다.
const DEV_FEED_TTL = 10 * 60_000; // 새로고침을 반복해도 10분에 한 번만 피드를 읽는다

function devFeed(): Plugin {
  let cache: FeedPayload = { items: [], fetchedAt: 0 };
  return {
    name: 'geekreader-dev-feed',
    configureServer(server) {
      server.middlewares.use('/api/items', (_req, res) => {
        void (async () => {
          try {
            if (Date.now() - cache.fetchedAt > DEV_FEED_TTL) {
              const r = await fetch(FEED_URL, {
                headers: { 'user-agent': FEED_USER_AGENT, accept: 'application/atom+xml, application/xml' },
              });
              if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
              cache = { items: mergeItems(cache.items, parseFeed(await r.text())), fetchedAt: Date.now() };
            }
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(cache));
          } catch (e) {
            res.statusCode = 502;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
        })();
      });
    },
  };
}

// 개발용 조종 채널. `?debug=1`로 열린 페이지는 `/__dev/events`(SSE)를 듣고 있다가,
// 누가 `GET /__dev/goto?u=<주소>`를 부르면 그 주소로 이동한다. 시뮬레이터 창을 다시 띄우지 않고
// 데모 모드·실제 피드·빌드본을 오가며 확인하는 데 쓴다 (scripts/sim-verify.ts).
// 이 PC에서 온 요청만 받고, 이 PC의 주소로만 보낸다.
const LOCAL_TARGET = /^(?:\/(?!\/)|https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$))/;
const isLoopback = (addr: string | undefined): boolean =>
  addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

function devControl(): Plugin {
  const listeners = new Set<ServerResponse>();
  return {
    name: 'geekreader-dev-control',
    configureServer(server) {
      server.middlewares.use('/__dev/events', (req, res) => {
        if (!isLoopback(req.socket.remoteAddress)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          // The built app (vite preview, another port) listens here too.
          'access-control-allow-origin': '*',
        });
        res.write('retry: 1000\n\n');
        listeners.add(res);
        req.on('close', () => listeners.delete(res));
      });
      server.middlewares.use('/__dev/goto', (req, res) => {
        const target = new URL(req.url ?? '', 'http://localhost').searchParams.get('u') ?? '';
        if (!isLoopback(req.socket.remoteAddress) || !LOCAL_TARGET.test(target)) {
          res.statusCode = 403;
          res.end('local targets only');
          return;
        }
        for (const l of listeners) l.write(`data: ${JSON.stringify({ url: target })}\n\n`);
        res.end(String(listeners.size)); // how many pages were told
      });
    },
  };
}

// Even Hub는 dist/를 그대로 패키징하므로 상대 경로(base './')로 빌드한다.
export default defineConfig({
  base: './',
  server: { port: 5175, strictPort: true },
  plugins: [devFeed(), devControl()],
});
