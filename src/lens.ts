// Puts ROWS lines of text on the glasses and keeps them in step with what the
// controller wants shown.
//
// The page is one invisible full-lens text container that receives input, laid under
// ROWS text containers at the layout.ts grid (8 text objects, the per-page maximum).
// Input goes to a text container rather than a list: a list keeps swipes for moving
// its own selection, while a text container holding a single space has nothing to
// scroll, so each swipe arrives at once as SCROLL_TOP / SCROLL_BOTTOM.
//
// The page is built once; after that only rows whose text or brightness changed are
// sent, one textContainerUpgrade each, so the lens does not flicker. The rows keep the
// containers' default padding: a line of text needs about 37px of the 40px pitch, and
// without the padding descenders get cut.

import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk';
import { bridge } from './bridge';
import { LENS_H, LENS_W, ROW_H, ROW_X, ROW_Y, ROWS, type Row } from './layout';
import { log } from './log';
import { isDebug } from './params';

const INPUT_ID = 1;
const rowId = (i: number): number => INPUT_ID + 1 + i;
const rowName = (i: number): string => `row${i}`;

function inputSurface(): TextContainerProperty {
  return new TextContainerProperty({
    containerID: INPUT_ID,
    containerName: 'input',
    xPosition: 0,
    yPosition: 0,
    width: LENS_W,
    height: LENS_H,
    content: ' ',
    isEventCapture: 1,
    borderWidth: 0,
    paddingLength: 0,
  });
}

function rowContainer(i: number, row: Row): TextContainerProperty {
  return new TextContainerProperty({
    containerID: rowId(i),
    containerName: rowName(i),
    xPosition: ROW_X,
    yPosition: ROW_Y[i],
    width: LENS_W - ROW_X,
    height: ROW_H,
    content: row.text,
    textColor: row.color,
    isEventCapture: 0,
  });
}

const sameRow = (a: Row, b: Row): boolean => a.text === b.text && a.color === b.color;

export class Lens {
  /** What the glasses show now; null when the page has to be built (again). */
  private shown: Row[] | null = null;
  private enabled = true;
  private drawing = false;
  private dirty = false;
  /** Bumped by resume/suspend, so a draw already in flight cannot mark a stale page as shown. */
  private epoch = 0;
  /** When the last row was sent. A text re-layout can fire a stray scroll event. */
  lastSentAt = 0;

  constructor(private readonly wanted: () => Row[]) {}

  /** Start drawing again with a fresh page (the app came back to the glasses). */
  resume(): void {
    this.epoch++;
    this.enabled = true;
    this.shown = null;
  }

  /** Stop drawing (the app left the glasses or is closing). */
  suspend(): void {
    this.epoch++;
    this.enabled = false;
    this.shown = null;
  }

  /** Bring the glasses up to date. Calls made while a draw is running fold into one more. */
  update(): void {
    if (!this.enabled) return;
    this.dirty = true;
    if (!this.drawing) void this.drain();
  }

  private async drain(): Promise<void> {
    this.drawing = true;
    while (this.dirty && this.enabled) {
      this.dirty = false;
      try {
        await this.draw(this.wanted());
      } catch (e) {
        log(`lens draw failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    }
    this.drawing = false;
  }

  private async draw(rows: Row[]): Promise<void> {
    const epoch = this.epoch;
    const b = await bridge();
    if (this.shown === null) {
      const page = { containerTotalNum: ROWS + 1, textObject: [inputSurface(), ...rows.map((r, i) => rowContainer(i, r))] };
      // The start-up page can be created once per launch; later builds replace it.
      const result = await b.createStartUpPageContainer(new CreateStartUpPageContainer(page));
      if (result !== StartUpPageCreateResult.success) await b.rebuildPageContainer(new RebuildPageContainer(page));
    } else {
      for (let i = 0; i < ROWS; i++) {
        if (sameRow(rows[i], this.shown[i])) continue;
        this.lastSentAt = Date.now();
        await b.textContainerUpgrade(
          new TextContainerUpgrade({ containerID: rowId(i), containerName: rowName(i), content: rows[i].text, textColor: rows[i].color }),
        );
      }
    }
    if (epoch === this.epoch) this.shown = rows.slice();
    // ?debug=1: what was just sent to the glasses, read by scripts/sim-verify.ts.
    if (isDebug) console.debug(`[lens] ${JSON.stringify({ rows: rows.map((r) => r.text), colors: rows.map((r) => r.color) })}`);
  }
}
