// What the lens shows, as ROWS lines of text. Pure (text.ts only), so the phone preview
// and the tests use exactly what controller.ts sends to the glasses.
//
// The lens is 576×288 and holds 7 rows at a 40px pitch. A
// Hangul glyph is 18px, so one row takes about 31 Hangul characters.

import type { FeedItem } from '../shared/feed';
import { clip, textWidth, wrapRows } from './text';

export const ROWS = 7;
export const LENS_W = 576;
export const LENS_H = 288;
/** Top of each row's text container, and its height (the last row ends at 286 < 288). */
export const ROW_Y = [6, 46, 86, 126, 166, 206, 246];
export const ROW_H = 40;
/** Left edge of the rows. At 0 the first glyph starts on the lens's first pixel column
 * (fine in the simulator). TODO(device): if first letters look cut, set this to 4. */
export const ROW_X = 0;
// Keeps a row clear of the container's inner padding: a row that is even slightly too
// wide wraps inside its 40px container and its second half disappears.
const LINE_MARGIN = 8;
export const PER = LENS_W - ROW_X - LINE_MARGIN;

// Text brightness, 0..4 (SDK `textColor`). TODO(device): the simulator may not show how
// readable the dimmer levels are outdoors — raise BODY/STATUS to 4 if they wash out.
export const TITLE = 4;
export const BODY = 3;
export const STATUS = 2;

export interface Row {
  text: string;
  color: number;
}

const BULLET = '• ';
const INDENT = '   '; // 15px, about the width of "• " (14px)
const MORE = ' …';
const ANY_ROWS = 999;

const row = (text: string, color: number): Row => ({ text, color });

function pad(rows: Row[], n: number): Row[] {
  const out = rows.slice(0, n);
  while (out.length < n) out.push(row('', BODY));
  return out;
}

/** Each bullet as wrapped lens lines, marked and hanging-indented. */
function bulletBlocks(item: FeedItem): string[][] {
  const per = PER - textWidth(INDENT);
  return item.bullets.map((b) => wrapRows(b, per, ANY_ROWS).map((r, i) => (i === 0 ? BULLET : INDENT) + r));
}

/** The whole summary as lens lines. */
export const bulletLines = (item: FeedItem): string[] => bulletBlocks(item).flat();

/** Mark a line as "there is more below". */
function withMore(line: string): string {
  if (line.endsWith('…')) return line;
  const cut = clip(line, PER - textWidth(MORE));
  return cut === line ? line + MORE : cut;
}

export function ago(published: string, now: number): string {
  const t = Date.parse(published);
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / (24 * 60))}일 전`;
}

const SEP = ' · ';
const statusRow = (parts: string[]): Row => row(clip(parts.filter(Boolean).join(SEP), PER), STATUS);

/** Browse view: title (up to 3 rows), as much of the summary as fits, a status row. */
export function cardRows(item: FeedItem, pos: number, total: number, saved: boolean, now: number): Row[] {
  const title = wrapRows(item.title, PER, 3);
  const room = ROWS - 1 - title.length;
  const lines = bulletLines(item);
  const body = lines.slice(0, room);
  if (lines.length > room && body.length) body[body.length - 1] = withMore(body[body.length - 1]);
  return [
    ...pad([...title.map((t) => row(t, TITLE)), ...body.map((t) => row(t, BODY))], ROWS - 1),
    statusRow([`${pos}/${total}`, ago(item.published, now), item.author, saved ? '저장됨' : '']),
  ];
}

const READ_ROWS = ROWS - 1;
const NO_SUMMARY = '(피드에 요약이 없는 글)';

/** Read view pages: the summary lines, READ_ROWS to a page. A bullet whose first line
 * would sit alone at the bottom of a page starts the next page instead. Always at least
 * one page. */
export function readPages(item: FeedItem): string[][] {
  const pages: string[][] = [[]];
  for (const block of bulletBlocks(item)) {
    const left = READ_ROWS - pages[pages.length - 1].length;
    if (left === 1 && block.length > 1) pages.push([]);
    for (const line of block) {
      if (pages[pages.length - 1].length === READ_ROWS) pages.push([]);
      pages[pages.length - 1].push(line);
    }
  }
  return pages[0].length ? pages : [[NO_SUMMARY]];
}

export function readRows(item: FeedItem, page: number, pos: number, total: number, saved: boolean): Row[] {
  const pages = readPages(item);
  const p = Math.max(0, Math.min(pages.length - 1, page));
  return [
    ...pad(
      pages[p].map((t) => row(t, TITLE)),
      READ_ROWS,
    ),
    statusRow([`요약 ${p + 1}/${pages.length}`, `글 ${pos}/${total}`, saved ? '저장됨' : '']),
  ];
}

/** Status / end screens: a heading, then lines that wrap instead of being cut. */
export function messageRows(heading: string, lines: string[]): Row[] {
  const body = lines.flatMap((l) => (l ? wrapRows(l, PER, 2) : ['']));
  return pad([row(clip(heading, PER), TITLE), row('', BODY), ...body.map((t) => row(t, BODY))], ROWS);
}
