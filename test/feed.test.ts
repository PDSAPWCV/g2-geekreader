import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, htmlToBullets, isFeedItem, mergeItems, parseFeed, type FeedItem } from '../shared/feed';

// Made-up entries in the shape of the real feed (Atom, CDATA title/content, a summary
// cut with a bare "…" after the closing tags).
const ATOM = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom'>
<title>GeekNews - 테스트</title>
<entry>
  <title><![CDATA[첫 번째 글 <제목> & 기호]]></title>
  <link rel='alternate' type='text/html' href='https://news.hada.io/topic?id=1002&amp;utm_source=geeknews&amp;utm_medium=rss' />
  <id>https://news.hada.io/topic?id=1002</id>
  <updated>2026-11-17T02:44:46+09:00</updated>
  <published>2026-11-17T02:44:46+09:00</published>
  <author>
    <name>neo</name>
    <uri>https://news.hada.io/user/neo</uri>
  </author>
  <content type='html' xml:lang='ko'><![CDATA[<div><ul><li><strong>굵은 말</strong>로 시작하는 첫 줄</li><li><code>a &lt; b</code> 그리고 R&amp;D</li><li>잘린 줄</li></ul></div>…]]></content>
</entry><entry>
  <title><![CDATA[두 번째 글]]></title>
  <link rel='alternate' type='text/html' href='https://news.hada.io/topic?id=1001' />
  <id>https://news.hada.io/topic?id=1001</id>
  <published>2026-11-17T01:00:00+09:00</published>
  <author><name>someone</name></author>
  <content type='html'><![CDATA[<p>문단 하나.</p><p>문단   둘<br>줄바꿈 뒤</p>]]></content>
</entry><entry>
  <title>이스케이프된 &lt;제목&gt;</title>
  <link href="https://news.hada.io/topic?id=1000"/>
  <id>https://news.hada.io/topic?id=1000</id>
  <updated>2026-11-16T20:00:00+09:00</updated>
  <content type='html'>&lt;ul&gt;&lt;li&gt;엔티티로 감싼 본문&lt;/li&gt;&lt;/ul&gt;</content>
</entry><entry>
  <title><![CDATA[주제 번호가 없는 항목]]></title>
  <link rel='alternate' href='https://news.hada.io/about' />
  <id>https://news.hada.io/about</id>
</entry>
</feed>`;

test('parseFeed reads id, title, author, date and a canonical url', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 3, 'the entry without a topic id is skipped');
  const [a, b, c] = items;
  assert.equal(a.id, 1002);
  assert.equal(a.title, '첫 번째 글 <제목> & 기호');
  assert.equal(a.url, 'https://news.hada.io/topic?id=1002');
  assert.equal(a.author, 'neo');
  assert.equal(a.published, '2026-11-17T02:44:46+09:00');
  assert.equal(b.author, 'someone');
  assert.equal(c.title, '이스케이프된 <제목>');
  assert.equal(c.published, '2026-11-16T20:00:00+09:00', 'falls back to <updated>');
  assert.equal(c.author, '');
  assert.ok(items.every(isFeedItem));
});

test('summary becomes plain bullets and the cut is marked', () => {
  const [a, b, c] = parseFeed(ATOM);
  assert.deepEqual(a.bullets, ['굵은 말로 시작하는 첫 줄', 'a < b 그리고 R&D', '잘린 줄…']);
  assert.equal(a.truncated, true);
  assert.deepEqual(b.bullets, ['문단 하나.', '문단 둘', '줄바꿈 뒤']);
  assert.equal(b.truncated, false);
  assert.deepEqual(c.bullets, ['엔티티로 감싼 본문']);
});

test('htmlToBullets edge cases', () => {
  assert.deepEqual(htmlToBullets(''), { bullets: [], truncated: false });
  assert.deepEqual(htmlToBullets('<ul><li>끝이 이미 줄임표…</li></ul>'), {
    bullets: ['끝이 이미 줄임표…'],
    truncated: true,
  });
  assert.deepEqual(htmlToBullets('<div>…</div>'), { bullets: [], truncated: true });
  assert.deepEqual(htmlToBullets('<script>alert(1)</script><li>x</li>').bullets, ['alert(1)', 'x']);
});

test('decodeEntities decodes once', () => {
  assert.equal(decodeEntities('&amp;lt; &#44032; &#xAC00; &nbsp;|&unknown;'), '&lt; 가 가  |&unknown;');
});

test('mergeItems unions by id, newest first, capped', () => {
  const mk = (id: number, published: string, title = `t${id}`): FeedItem => ({
    id,
    title,
    url: `https://news.hada.io/topic?id=${id}`,
    author: '',
    published,
    bullets: [],
    truncated: false,
  });
  const old = [mk(2, '2026-11-17T01:00:00+09:00', 'old title'), mk(1, '2026-11-17T00:00:00+09:00')];
  const fresh = [mk(3, '2026-11-17T02:00:00+09:00'), mk(2, '2026-11-17T01:00:00+09:00', 'new title')];
  const merged = mergeItems(old, fresh);
  assert.deepEqual(
    merged.map((i) => i.id),
    [3, 2, 1],
  );
  assert.equal(merged[1].title, 'new title');
  assert.deepEqual(
    mergeItems(old, fresh, 2).map((i) => i.id),
    [3, 2],
  );
});

test('isFeedItem rejects malformed data', () => {
  assert.equal(isFeedItem(null), false);
  assert.equal(isFeedItem({ id: '1', title: 'x' }), false);
  assert.equal(
    isFeedItem({ id: 1, title: 'x', url: 'u', author: '', published: '', bullets: [1], truncated: false }),
    false,
  );
});
