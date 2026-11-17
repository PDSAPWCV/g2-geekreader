import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FeedItem } from '../shared/feed';
import { ago, bulletLines, cardRows, messageRows, PER, readPages, readRows, ROWS, type Row } from '../src/layout';
import { mockItems } from '../src/mock';
import { textWidth } from '../src/text';

const NOW = Date.parse('2026-11-17T12:00:00+09:00');
const LONG: FeedItem = {
  id: 1,
  title: '아주 긴 제목 '.repeat(20),
  url: 'https://news.hada.io/topic?id=1',
  author: 'a-very-long-author-name-that-keeps-going-and-going-and-going-on',
  published: new Date(NOW - 5 * 60_000).toISOString(),
  bullets: [
    '띄어쓰기없이아주길게이어지는한글문장'.repeat(6),
    'https://example.com/' + 'a-very-long-path-segment/'.repeat(8),
    '보통 길이의 줄 '.repeat(12),
    '日本語の文も混ざることがあります。'.repeat(5),
  ],
  truncated: true,
};
const ALL = [...mockItems(NOW), LONG];

function assertFits(rows: Row[], what: string): void {
  assert.equal(rows.length, ROWS, `${what}: ${ROWS} rows`);
  for (const r of rows) {
    assert.ok(textWidth(r.text) <= PER, `${what}: "${r.text}" is ${textWidth(r.text)}px > ${PER}px`);
    assert.ok(r.color >= 0 && r.color <= 4, `${what}: brightness in range`);
  }
}

test('every screen is 7 rows and no row is wider than the lens', () => {
  for (const it of ALL) {
    assertFits(cardRows(it, 12, 120, true, NOW), `card ${it.id}`);
    readPages(it).forEach((_, p) => assertFits(readRows(it, p, 12, 120, true), `read ${it.id} p${p}`));
  }
  assertFits(messageRows('GeekReader KR', ['피드를 불러오지 못했습니다', 'x'.repeat(300), '', '탭: 다시 시도']), 'message');
});

test('card: title on top, status on the last row, cut summary is marked', () => {
  const [first] = mockItems(NOW);
  const rows = cardRows(first, 1, 5, false, NOW);
  assert.ok(first.title.startsWith(rows[0].text.slice(0, 10)));
  assert.equal(rows[ROWS - 1].text, '1/5 · 5분 전 · sample');
  assert.ok(cardRows(first, 1, 5, true, NOW)[ROWS - 1].text.endsWith('저장됨'));
  const lastBody = rows[ROWS - 2].text;
  assert.ok(lastBody.endsWith('…'), 'more summary than fits → last body row ends with …');
});

test('read pages hold the whole summary in order', () => {
  for (const it of ALL) {
    const lines = bulletLines(it);
    const pages = readPages(it);
    assert.ok(pages.length >= 1);
    if (lines.length) assert.deepEqual(pages.flat(), lines);
    assert.ok(pages.every((p) => p.length >= 1 && p.length <= ROWS - 1));
  }
  const empty = mockItems(NOW).find((it) => !it.bullets.length)!;
  assert.equal(readPages(empty).length, 1);
  const rows = readRows(LONG, 99, 3, 9, false);
  assert.match(rows[ROWS - 1].text, /^요약 (\d+)\/\1 · 글 3\/9$/, 'page number is clamped to the last page');
});

test('ago', () => {
  const t = (min: number) => new Date(NOW - min * 60_000).toISOString();
  assert.equal(ago(t(0), NOW), '방금');
  assert.equal(ago(t(59), NOW), '59분 전');
  assert.equal(ago(t(60), NOW), '1시간 전');
  assert.equal(ago(t(23 * 60 + 59), NOW), '23시간 전');
  assert.equal(ago(t(49 * 60), NOW), '2일 전');
  assert.equal(ago(t(-10), NOW), '방금', 'clock skew');
  assert.equal(ago('', NOW), '');
});
