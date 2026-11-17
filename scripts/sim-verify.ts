// End-to-end check against ONE running Even Hub simulator window.
//
// Before running:   npm run dev            (port 5175)
//                   npm run simulator:auto (automation API on port 9898)
// Then:             npm run verify:sim
//
// It drives the glasses touch input over the simulator's automation API and checks,
// after every step,
//   1. what the app says it drew (console line `[lens] …`, enabled by ?debug=1), and
//   2. what the simulator actually rendered: for each of the 7 rows it measures the
//      lit pixels in the 576×288 screenshot and compares the right edge with the width
//      src/text.ts predicted. A row that is wider than predicted wraps inside its 40px
//      container and loses its tail, so a mismatch here is the failure that matters.
//
// The page is moved between demo data, the real feed and (optionally) the
// production build with the dev server's /__dev/goto command (pages opened with
// ?debug=1 follow it) — the window is never relaunched, and the run ends back on the
// dev page so it can be started again on the same window.
//
// Optional: `--prod <url>` (a `vite preview` of dist/) adds a run of the built app against
// the feed relay. With `--worker <url>` (a local `wrangler dev` of worker/) the built app is
// pointed at that relay (`npm run verify:sim:full`); without it the built app uses the
// address compiled into it, i.e. the deployed Worker (`npm run verify:sim:deployed`).

import { mkdirSync, writeFileSync } from 'node:fs';
import { LENS_H, LENS_W, ROW_H, ROW_Y, ROWS } from '../src/layout.ts';
import { decodePng, rowInk, type Image } from './png.ts';
import { textWidth } from '../src/text.ts';

/** `--name value` on the command line, else the environment variable, else the default. */
function option(name: string, env: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return (i >= 0 ? process.argv[i + 1] : undefined) ?? process.env[env] ?? fallback;
}
const SIM = option('sim', 'SIM_API', 'http://127.0.0.1:9898/api');
const DEV = option('dev', 'DEV_URL', 'http://localhost:5175');
const PROD = option('prod', 'PROD_URL');
const WORKER = option('worker', 'WORKER_URL');
const OUT = option('out', 'OUT', '.verify');
/** An address nothing listens on, for the "feed unreachable" screen. */
const DEAD_FEED = 'http://127.0.0.1:59999';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── results ──────────────────────────────────────────────────────────────────
const lines: string[] = [];
let passed = 0;
const failures: string[] = [];
const say = (s: string): void => {
  lines.push(s);
  console.log(s);
};
function check(name: string, ok: boolean, detail = ''): boolean {
  if (ok) passed++;
  else failures.push(name);
  say(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `\n       ${detail}` : ''}`);
  return ok;
}

// ── simulator automation API ─────────────────────────────────────────────────
type Action = 'up' | 'down' | 'click' | 'double_click' | 'long_press' | 'long_press_release';
interface Lens {
  rows: string[];
  colors: number[];
}

let lastId = -1;
let lens: Lens | null = null;
let draws = 0;
const consoleErrors: string[] = [];

async function pump(): Promise<void> {
  const r = await fetch(`${SIM}/console${lastId >= 0 ? `?since_id=${lastId}` : ''}`);
  const body = (await r.json()) as { entries?: Array<{ id: number; level: string; message: string }> };
  for (const e of body.entries ?? []) {
    if (e.id <= lastId) continue;
    lastId = e.id;
    if (e.message.startsWith('[lens] ')) {
      lens = JSON.parse(e.message.slice(7)) as Lens;
      draws++;
    } else if (e.level === 'error' || e.level === 'warn') {
      consoleErrors.push(`${e.level}: ${e.message.slice(0, 200)}`);
    }
  }
}

async function input(action: Action): Promise<void> {
  const r = await fetch(`${SIM}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!r.ok) throw new Error(`input ${action}: HTTP ${r.status}`);
}

async function until(pred: (l: Lens) => boolean, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    await pump();
    if (lens && pred(lens)) return true;
    if (Date.now() > end) return false;
    await sleep(80);
  }
}

const status = (l: Lens): string => l.rows[ROWS - 1];
const show = (): string => (lens ? lens.rows.map((r) => `[${r}]`).join(' ') : '(nothing drawn)');
const isCard = (k: number, n: number) => (l: Lens) => new RegExp(`^${k}/${n} · `).test(status(l));
const isRead = (p: number, pages: number, k: number, n: number) => (l: Lens) =>
  status(l).startsWith(`요약 ${p}/${pages} · 글 ${k}/${n}`);
const hasRow = (text: string) => (l: Lens) => l.rows.includes(text);

// ── per-screen pixel checks ──────────────────────────────────────────────────
interface Measure {
  shot: string;
  text: string;
  color: number;
  predicted: number;
  left: number;
  right: number;
  peak: number;
}
const measures: Measure[] = [];
let shots = 0;

async function snap(label: string): Promise<Image> {
  const r = await fetch(`${SIM}/screenshot/glasses`);
  const buf = Buffer.from(await r.arrayBuffer());
  const name = `${String(++shots).padStart(3, '0')}-${label.replace(/[^\w가-힣.-]+/g, '_').slice(0, 60)}.png`;
  writeFileSync(`${OUT}/${name}`, buf);
  return decodePng(buf);
}

/** Compare the simulator's framebuffer with what the app says it drew. */
async function pixels(label: string): Promise<void> {
  await sleep(180); // let the framebuffer catch up with the last container update
  await pump();
  if (!lens) return;
  const want = lens;
  const img = await snap(label);
  const problems: string[] = [];
  if (img.w !== LENS_W || img.h !== LENS_H) problems.push(`screenshot is ${img.w}x${img.h}`);
  for (let i = 0; i < ROWS; i++) {
    const text = want.rows[i];
    const ink = rowInk(img, ROW_Y[i], ROW_Y[i] + ROW_H);
    if (!text.trim()) {
      if (ink) problems.push(`row ${i + 1} should be blank but has pixels at x=${ink.left}..${ink.right}`);
      continue;
    }
    if (!ink) {
      problems.push(`row ${i + 1} "${text}" is not visible`);
      continue;
    }
    if (ink.right > LENS_W - 2) problems.push(`row ${i + 1} touches the right edge (x=${ink.right})`);
    measures.push({ shot: label, text, color: want.colors[i], predicted: textWidth(text), left: ink.left, right: ink.right, peak: ink.peak });
  }
  // Nothing may be drawn outside the rows either (above the first, below the last).
  const stray = rowInk(img, 0, ROW_Y[0]) ?? rowInk(img, ROW_Y[ROWS - 1] + ROW_H, img.h);
  if (stray) problems.push(`pixels outside the row grid at x=${stray.left}..${stray.right}`);
  check(`pixels: ${label}`, problems.length === 0, problems.join('; '));
}

// ── steps ────────────────────────────────────────────────────────────────────
/** Send one input, wait for the expected screen, then check its pixels. */
async function step(name: string, action: Action, pred: (l: Lens) => boolean, px = true): Promise<boolean> {
  await input(action);
  const ok = check(name, await until(pred), show());
  if (ok && px) await pixels(name);
  await sleep(380); // clear the app's 300ms swipe throttle before the next input
  return ok;
}

/** Send one input that must NOT change the screen. */
async function inert(name: string, action: Action, pred: (l: Lens) => boolean): Promise<void> {
  await input(action);
  await sleep(700);
  await pump();
  check(name, !!lens && pred(lens), show());
}

async function goto(url: string, name: string, pred: (l: Lens) => boolean, ms = 20_000): Promise<boolean> {
  await pump();
  lens = null; // only a draw made by the new page counts
  const r = await fetch(`${DEV}/__dev/goto?u=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error(`goto ${url}: HTTP ${r.status}`);
  if ((await r.text()) === '0') {
    throw new Error('no page is listening for navigation — open the simulator with "npm run simulator:auto" (?debug=1)');
  }
  const ok = check(name, await until(pred, ms), show());
  await sleep(600);
  if (ok) await pixels(name);
  return ok;
}

// ── phase A: demo data (deterministic) ───────────────────────────────────────
async function phaseMock(): Promise<void> {
  say('\n== A. 데모 모드: 조작 규칙 ==');
  const n = 4; // the fifth demo topic is older than the default 24-hour range
  if (!(await goto('/?mock=1&reset=1&debug=1', 'A01 첫 화면은 첫 글의 카드', isCard(1, n)))) return;
  check('A02 카드: 제목이 첫 줄', !!lens && lens.rows[0].startsWith('데모 글 1'), show());
  check('A03 카드: 요약이 잘린 곳에 … 표시', !!lens && lens.rows[ROWS - 2].endsWith('…'), show());
  check('A04 카드: 밝기 제목 4 > 요약 3 > 상태 2', !!lens && lens.colors[0] === 4 && lens.colors[3] === 3 && lens.colors[6] === 2);

  await inert('A05 맨 위에서 위로 쓸면 그대로', 'up', isCard(1, n));
  await step('A06 아래로 쓸기 → 2번 글', 'down', isCard(2, n));
  await step('A07 아래로 쓸기 → 3번 글 (영문 제목)', 'down', (l) => isCard(3, n)(l) && l.rows[0].startsWith('Demo topic 3'));
  await step('A08 아래로 쓸기 → 4번 글 (요약 없음)', 'down', isCard(4, n));
  await step('A09 탭 → 요약 읽기 (요약 없는 글 안내)', 'click', (l) => isRead(1, 1, 4, n)(l) && l.rows[0] === '(피드에 요약이 없는 글)');
  await step('A10 읽기에서 두 번 탭 → 같은 글 카드로 (종료 아님)', 'double_click', isCard(4, n));
  await step('A11 위로 쓸기 → 3번 글', 'up', isCard(3, n));
  await step('A12 위로 쓸기 → 2번 글', 'up', isCard(2, n));
  await step('A13 위로 쓸기 → 1번 글', 'up', isCard(1, n));

  await step('A14 탭 → 요약 1/2쪽', 'click', isRead(1, 2, 1, n));
  check('A15 읽기: 본문 밝기 4, 상태 2', !!lens && lens.colors[0] === 4 && lens.colors[6] === 2);
  await step('A16 아래로 → 2/2쪽', 'down', isRead(2, 2, 1, n));
  await step('A17 위로 → 1/2쪽', 'up', isRead(1, 2, 1, n));
  await step('A18 첫 쪽에서 위로 → 그 글 카드', 'up', isCard(1, n));
  await step('A19 탭 → 다시 읽기', 'click', isRead(1, 2, 1, n), false);
  await step('A20 아래로 → 2/2쪽', 'down', isRead(2, 2, 1, n), false);
  await step('A21 마지막 쪽에서 아래로 → 다음 글 카드', 'down', isCard(2, n));
  await step('A22 탭 → 2번 글 읽기 (한 쪽짜리)', 'click', isRead(1, 1, 2, n));
  await step('A23 읽기에서 탭 → 다음 글 카드', 'click', isCard(3, n));
  await step('A24 위로 → 2번 글', 'up', isCard(2, n), false);

  await step('A25 길게 누르기 → 저장됨 표시', 'long_press', (l) => isCard(2, n)(l) && status(l).endsWith('저장됨'));
  await input('long_press_release');
  await inert('A26 길게 누른 직후의 탭은 무시 (요약이 열리지 않음)', 'click', (l) => isCard(2, n)(l) && status(l).endsWith('저장됨'));
  await step('A27 읽기 화면에서도 저장 표시', 'click', (l) => isRead(1, 1, 2, n)(l) && status(l).endsWith('저장됨'));
  await step('A28 읽기에서 길게 누르기 → 저장 취소', 'long_press', (l) => isRead(1, 1, 2, n)(l) && !status(l).includes('저장됨'));
  await input('long_press_release');
  await sleep(700);
  await step('A29 두 번 탭 → 카드, 저장 표시 없음', 'double_click', (l) => isCard(2, n)(l) && !status(l).includes('저장됨'));

  await input('down');
  await input('down');
  await sleep(900);
  await pump();
  check('A30 연달아 두 번 쓸어도 한 글만 넘어감 (300ms 제한)', !!lens && isCard(3, n)(lens), show());

  await step('A31 아래로 → 4번 글', 'down', isCard(4, n), false);
  await step('A32 마지막 글에서 아래로 → 끝 화면', 'down', hasRow(`${n}개를 모두 봤습니다`));
  await inert('A33 끝 화면에서 아래로 쓸면 그대로', 'down', hasRow(`${n}개를 모두 봤습니다`));
  await inert('A34 끝 화면에서 길게 눌러도 그대로', 'long_press', hasRow(`${n}개를 모두 봤습니다`));
  await input('long_press_release');
  await sleep(700);
  await step('A35 끝 화면에서 탭 → 새 글 없음 안내', 'click', (l) => hasRow(`${n}개를 모두 봤습니다`)(l) && hasRow('새 글이 없습니다')(l));
  await step('A36 끝 화면에서 위로 → 마지막 글', 'up', isCard(4, n));

  // Reload without ?reset: the read marks must have been stored.
  await goto('/?mock=1&debug=1', 'A37 다시 열면 읽은 글은 빠지고 새 글 없음 화면', (l) => l.rows[0] === 'GeekReader KR' && hasRow('새 글이 없습니다')(l));
}

// ── phase B: the real feed through the dev relay ─────────────────────────────
async function walkToEnd(): Promise<number> {
  // From any card: swipe down until the end card. Returns how many swipes it took.
  let swipes = 0;
  while (lens && /^\d+\/\d+ · /.test(status(lens)) && swipes < 200) {
    const before = status(lens);
    await input('down');
    await until((l) => status(l) !== before, 3000);
    await sleep(380);
    swipes++;
  }
  return swipes;
}

async function phaseFeed(): Promise<void> {
  say('\n== B. 실제 피드: 모든 글의 카드와 요약 쪽 ==');
  const firstCard = (l: Lens) => /^1\/\d+ · /.test(status(l));
  if (!(await goto('/?reset=1&debug=1', 'B01 실제 피드의 첫 글 카드', firstCard))) return;
  const n = Number(/^1\/(\d+)/.exec(status(lens!))![1]);
  say(`     글 ${n}개`);

  let pageTotal = 0;
  for (let k = 1; k <= n; k++) {
    const title = lens!.rows[0].slice(0, 28);
    if (k > 1) await pixels(`B 글 ${k}/${n} 카드 "${title}"`);
    if (!(await step(`B 글 ${k}/${n} 탭 → 요약 1쪽`, 'click', (l) => status(l).startsWith('요약 1/') && status(l).includes(`글 ${k}/${n}`)))) return;
    const pages = Number(/^요약 1\/(\d+)/.exec(status(lens!))![1]);
    pageTotal += pages;
    for (let p = 2; p <= pages; p++) {
      if (!(await step(`B 글 ${k}/${n} 요약 ${p}/${pages}쪽`, 'down', isRead(p, pages, k, n)))) return;
    }
    const next = k < n ? isCard(k + 1, n) : hasRow(`${n}개를 모두 봤습니다`);
    if (!(await step(`B 글 ${k}/${n} 마지막 쪽에서 아래로 → ${k < n ? '다음 글' : '끝 화면'}`, 'down', next, k === n))) return;
  }
  say(`     요약 쪽 수 합계 ${pageTotal} (글당 평균 ${(pageTotal / n).toFixed(1)}쪽)`);

  await input('click');
  const answered = await until((l) => hasRow('새 글이 없습니다')(l) || firstCard(l), 20_000);
  const fresh = !!lens && firstCard(lens);
  check('B90 끝 화면에서 탭 → 피드 다시 확인', answered, show());
  say(`     ${fresh ? '새 글이 와서 맨 위로 이동함' : '새 글 없음'}`);
  await sleep(500);
  if (fresh) await walkToEnd();

  await goto('/?debug=1', 'B91 다시 열면 모두 읽음 → 새 글 없음 화면 (읽음 기록 유지)', (l) => l.rows[0] === 'GeekReader KR' && hasRow('새 글이 없습니다')(l));

  say('\n== B2. 피드 서버에 닿지 않을 때 ==');
  const offline = `/?debug=1&feed=${encodeURIComponent(DEAD_FEED)}`;
  if (await goto(offline, 'B92 받아 둔 사본이 새것이면 서버 없이도 화면이 뜸', (l) => l.rows[0] === 'GeekReader KR')) {
    await step('B93 탭 → 불러오기 실패 안내', 'click', hasRow('피드를 불러오지 못했습니다'));
    check('B94 실패 화면에 다시 시도 안내', !!lens && hasRow('탭: 다시 시도')(lens), show());
    await step('B95 다시 탭해도 실패 화면 유지 (앱이 멈추지 않음)', 'click', hasRow('피드를 불러오지 못했습니다'), false);
  }
}

// ── phase C: production build + feed relay Worker ────────────────────────────
async function phaseProd(): Promise<void> {
  // No `feed=` → the build has only VITE_FEED_BASE to go by (`reset=1` clears the phone
  // page setting, and a build has no /api), so a card here came from the deployed Worker.
  say(`\n== C. 빌드본 + 피드 중계 Worker (${WORKER || '빌드본에 들어 있는 배포 주소'}) ==`);
  const feed = WORKER ? `&feed=${encodeURIComponent(WORKER)}` : '';
  const url = `${PROD}/?reset=1&debug=1&ctl=${encodeURIComponent(DEV)}${feed}`;
  const firstCard = (l: Lens) => /^1\/\d+ · /.test(status(l));
  if (!(await goto(url, 'C01 빌드본이 Worker에서 받은 글을 카드로 표시', firstCard))) return;
  const n = Number(/^1\/(\d+)/.exec(status(lens!))![1]);
  await step('C02 아래로 → 2번 글', 'down', isCard(2, n));
  await step('C03 탭 → 요약 읽기', 'click', (l) => status(l).startsWith('요약 1/') && status(l).includes(`글 2/${n}`));
  await step('C04 두 번 탭 → 카드', 'double_click', isCard(2, n), false);
  await step('C05 길게 누르기 → 저장됨', 'long_press', (l) => status(l).endsWith('저장됨'), false);
  await input('long_press_release');
  await sleep(700);

  // Last: the root double tap. The app stops drawing and asks the host to close it.
  await pump();
  const before = draws;
  await input('double_click');
  await sleep(1500);
  await input('down');
  await sleep(900);
  await pump();
  check('C06 훑어보기에서 두 번 탭 → 종료 요청 후 더 그리지 않음', draws === before, `${draws - before} draws after exit`);
  const blank = await snap('C07 종료 뒤 안경 화면');
  check('C07 종료 뒤 안경 화면이 비워짐', rowInk(blank, 0, blank.h) === null);
}

// ── width report ─────────────────────────────────────────────────────────────
function widthReport(): void {
  say('\n== 글자 폭: 예측(src/text.ts) 대 시뮬레이터 실제 렌더링 ==');
  if (!measures.length) {
    say('측정한 줄이 없습니다');
    return;
  }
  // right edge = left padding + predicted width − the last glyph's right-side gap, so
  // (right − predicted) should be a near-constant few pixels.
  const offs = measures.map((m) => m.right - m.predicted).sort((a, b) => a - b);
  const median = offs[Math.floor(offs.length / 2)];
  const dev = (m: Measure): number => m.right - m.predicted - median;
  const worst = [...measures].sort((a, b) => Math.abs(dev(b)) - Math.abs(dev(a)));
  const widest = measures.reduce((a, b) => (b.right > a.right ? b : a));
  say(`측정한 줄 ${measures.length}개 (화면 ${shots}장)`);
  say(`줄이 시작하는 가장 왼쪽 위치: x=${Math.min(...measures.map((m) => m.left))}`);
  say(`오른쪽 끝 − 예측 폭: 중앙값 ${median}px, 범위 ${offs[0]}..${offs[offs.length - 1]}px`);
  say(`가장 오른쪽까지 간 줄: x=${widest.right} / ${LENS_W}px  "${widest.text}"`);
  say('예측과 가장 많이 어긋난 줄:');
  for (const m of worst.slice(0, 6)) say(`  ${dev(m) >= 0 ? '+' : ''}${dev(m)}px  예측 ${m.predicted}px  "${m.text}"`);

  // A wrapped row loses at least one whole word or CJK glyph (≥ ~18px) from view.
  const TOLERANCE = 14;
  const off = worst.filter((m) => Math.abs(dev(m)) > TOLERANCE);
  check(`모든 줄의 실제 폭이 예측과 ${TOLERANCE}px 안에서 일치 (줄바꿈으로 잘린 줄 없음)`, off.length === 0, `${off.length}줄 어긋남`);

  const peak = (c: number): number[] => measures.filter((m) => m.color === c).map((m) => m.peak);
  const avg = (a: number[]): number => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const [p4, p3, p2] = [avg(peak(4)), avg(peak(3)), avg(peak(2))];
  say(`밝기 단계별 최대 화소 밝기 평균: 4단계 ${p4}, 3단계 ${p3}, 2단계 ${p2}`);
  check('밝기 단계가 화면에서 구분됨 (4 > 3 > 2)', p4 > p3 && p3 > p2, `${p4} / ${p3} / ${p2}`);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const ping = await fetch(`${SIM}/ping`).then(
    (r) => r.ok,
    () => false,
  );
  if (!ping) throw new Error(`simulator automation API not reachable at ${SIM} — run "npm run simulator:auto" first`);
  await pump(); // skip console output from before this run
  consoleErrors.length = 0;

  await phaseMock();
  await phaseFeed();
  if (PROD) await phaseProd();
  else say('\n== C. 빌드본 + Worker: 주소를 주지 않아 건너뜀 (npm run verify:sim:full 또는 verify:sim:deployed) ==');

  say('\n== D. 마무리 ==');
  await goto('/?debug=1', 'D01 개발 화면으로 돌아와 다시 그림 (종료 뒤 재시작 포함)', (l) => l.rows.some((r) => r.trim() !== ''));
  widthReport();

  await pump();
  // Not the app's: the simulator logs this itself each time the page is navigated away
  // while one of its bridge calls is still pending.
  const SIMULATOR_RELOAD_NOTICE = "[TAURI] Couldn't find callback id";
  const unexpected = consoleErrors.filter(
    (e) => !e.includes(DEAD_FEED) && !e.includes(SIMULATOR_RELOAD_NOTICE) && !/Failed to fetch|ERR_CONNECTION_REFUSED/i.test(e),
  );
  for (const e of consoleErrors) say(`     ${e}`);
  check('콘솔에 예상 밖의 오류·경고 없음', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));
  say(`\n콘솔 오류·경고 ${consoleErrors.length}건 (끊긴 피드 서버 시험에서 나온 것 포함)`);

  say(`\n결과: 통과 ${passed}, 실패 ${failures.length}`);
  for (const f of failures) say(`  실패: ${f}`);
  writeFileSync(`${OUT}/report.txt`, lines.join('\n') + '\n');
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
