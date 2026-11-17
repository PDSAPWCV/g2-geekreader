// Line-fitting helpers for the lens. EVERYTHING that decides how much text fits on a
// row lives here. All widths are in PIXELS of the lens font.

// ── glyph widths ─────────────────────────────────────────────────────────────
// Measured in EvenHub simulator 0.9.5 (2026-11-15) by drawing "|" + c×20 + "|" and
// timing the gap against a "||" baseline. The simulator renders with the firmware's
// font pipeline, but confirm on real glasses — see the README device checklist.
//
// Printable ASCII 0x20..0x7E, in order.
// prettier-ignore
const ASCII_PX = [
  5, 4, 6, 14, 12, 14, 15, 4, 6, 6, 8, 10, 5, 10, 5, 5, //  !"#$%&'()*+,-./
  12, 7, 11, 12, 12, 12, 12, 12, 12, 12, 4, 5, 10, 10, 10, 12, // 0-9 :;<=>?
  17, 13, 12, 11, 12, 10, 10, 12, 12, 5, 8, 12, 9, 16, 12, 12, // @A-O
  12, 12, 12, 11, 10, 12, 13, 16, 13, 13, 12, 7, 5, 7, 10, 9, // P-Z [\]^_
  4, 11, 11, 10, 11, 10, 7, 11, 11, 5, 5, 9, 4, 16, 11, 10, // `a-o
  11, 11, 7, 10, 6, 11, 11, 15, 11, 11, 9, 8, 4, 8, 16, // p-z {|}~
];

export const HANGUL_PX = 18; // 가-힣, jamo (all measured samples: 18)
export const CJK_PX = 20; // kana, kanji, CJK/full-width punctuation (all samples: 20)
const DEFAULT_PX = 12; // anything unmeasured: a typical capital letter

/** Measured one-offs outside ASCII. */
const SPECIAL_PX: Record<string, number> = {
  '…': 10,
  '♪': 20,
  '‘': 5,
  '’': 5,
  '“': 8,
  '”': 8,
  '·': 5,
  '•': 9,
  '—': 15,
  '–': 15,
  '━': 20,
  '─': 20,
};

function isHangul(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) || // syllables
    (cp >= 0x1100 && cp <= 0x11ff) || // jamo
    (cp >= 0x3130 && cp <= 0x318f) || // compatibility jamo
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xd7b0 && cp <= 0xd7ff)
  );
}

/** Kana / kanji / CJK punctuation / full-width forms: breakable between any two glyphs. */
export function isCjk(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x303f) || // CJK symbols & punctuation (、。「」)
    (cp >= 0x3040 && cp <= 0x30ff) || // hiragana, katakana
    (cp >= 0x31f0 && cp <= 0x31ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility
    (cp >= 0xff00 && cp <= 0xffef) // full-width / half-width forms
  );
}

/** Pixel width of one character (one code point). */
export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x20 && cp <= 0x7e) return ASCII_PX[cp - 0x20];
  const special = SPECIAL_PX[ch];
  if (special != null) return special;
  if (isHangul(cp)) return HANGUL_PX;
  if (isCjk(cp)) return CJK_PX;
  if (cp >= 0xc0 && cp <= 0x24f) return 11; // accented Latin (é=10, ß=11, À=13)
  if (cp < 0x20 || (cp >= 0x300 && cp <= 0x36f) || cp === 0x200b || cp === 0xfe0f) return 0; // controls, combining marks
  return DEFAULT_PX;
}

/** Pixel width of `s` on the lens. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

const CLIP_MARK = '…'; // 10px (the old `~` is 16px)

/** Cut `s` so that textWidth(result) <= maxPx, marking the cut with `…`. */
export function clip(s: string, maxPx: number): string {
  if (textWidth(s) <= maxPx) return s;
  const budget = maxPx - charWidth(CLIP_MARK);
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out.trimEnd() + CLIP_MARK;
}

// ── wrapping ─────────────────────────────────────────────────────────────────
// Characters that must not start a line (Japanese kinsoku + common closers).
const NO_LINE_START = new Set([...'、。，．・：；？！ー～」』）】〉》〕’”…‥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ,.!?:;)]}']);

// Characters that must not end a line (openers).
const NO_LINE_END = new Set([...'「『（【〈《〔‘“([{']);

interface Unit {
  text: string;
  /** a space preceded this unit in the source (rendered only when not at line start) */
  space: boolean;
}

/**
 * Split into breakable units: Latin and Hangul words stay whole (Korean breaks between
 * 어절, i.e. at spaces), while every kana/kanji/CJK punctuation glyph is its own unit
 * because Japanese/Chinese may break between any two glyphs.
 */
function units(text: string): Unit[] {
  const out: Unit[] = [];
  let word = '';
  let pendingSpace = false;
  const flush = () => {
    if (word) {
      out.push({ text: word, space: pendingSpace });
      pendingSpace = false;
      word = '';
    }
  };
  for (const ch of text) {
    if (/\s/.test(ch)) {
      flush();
      if (out.length) pendingSpace = true;
      continue;
    }
    if (isCjk(ch.codePointAt(0) ?? 0)) {
      flush();
      out.push({ text: ch, space: pendingSpace });
      pendingSpace = false;
    } else {
      word += ch;
    }
  }
  flush();
  return out;
}

/** Hard-break a single unit that is wider than a whole line. */
function splitLong(u: Unit, maxPx: number): Unit[] {
  const parts: Unit[] = [];
  let cur = '';
  let w = 0;
  for (const ch of u.text) {
    const cw = charWidth(ch);
    if (cur && w + cw > maxPx) {
      parts.push({ text: cur, space: parts.length === 0 ? u.space : false });
      cur = '';
      w = 0;
    }
    cur += ch;
    w += cw;
  }
  if (cur) parts.push({ text: cur, space: parts.length === 0 ? u.space : false });
  return parts;
}

/**
 * Wrap `text` into at most `maxRows` rows, each at most `maxPx` wide. When it doesn't
 * fit, the last row is clipped with `…`.
 */
export function wrapRows(text: string, maxPx: number, maxRows: number): string[] {
  const all = units(text).flatMap((u) => (textWidth(u.text) > maxPx ? splitLong(u, maxPx) : [u]));
  const rows: Unit[][] = [[]];
  const widthOf = (row: Unit[], extra?: Unit): number => {
    const list = extra ? [...row, extra] : row;
    return list.reduce((w, u, i) => w + (i > 0 && u.space ? charWidth(' ') : 0) + textWidth(u.text), 0);
  };
  for (const u of all) {
    const row = rows[rows.length - 1];
    if (!row.length || widthOf(row, u) <= maxPx) {
      row.push(u);
      continue;
    }
    // Break before u. Kinsoku: a closer may not start the next line and an opener may
    // not end this one, so carry units down — but only while something stays on this
    // line and the carried units still fit on the new one.
    const next: Unit[] = [u];
    const firstCh = (x: Unit) => [...x.text][0];
    const lastCh = (x: Unit) => [...x.text].at(-1) ?? '';
    while (row.length > 1) {
      const needs =
        NO_LINE_START.has(firstCh(next[0])) || NO_LINE_END.has(lastCh(row[row.length - 1]));
      if (!needs) break;
      const cand = [row[row.length - 1], ...next];
      if (widthOf(cand) > maxPx) break;
      next.unshift(row.pop()!);
    }
    next[0] = { ...next[0], space: false };
    rows.push(next);
  }
  const render = (row: Unit[]) => row.map((u, i) => (i > 0 && u.space ? ' ' : '') + u.text).join('');
  if (rows.length <= maxRows) return rows.map(render).filter((r, i) => r || i === 0);
  const kept = rows.slice(0, maxRows - 1).map(render);
  const rest = rows
    .slice(maxRows - 1)
    .map(render)
    .join(' ');
  return [...kept, clip(rest, maxPx)];
}
