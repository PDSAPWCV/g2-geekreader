// Raw EvenHubEvent → Gesture. What each gesture DOES is decided in reader.ts.

import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';

export type Gesture =
  | 'tap'
  | 'doubleTap'
  | 'swipeUp'
  | 'swipeDown'
  | 'longPress'
  | 'longPressRelease'
  | 'foregroundEnter'
  | 'foregroundExit';

/** Gestures the reader binds (lifecycle gestures are handled by the controller). */
export type InputGesture = Exclude<Gesture, 'foregroundEnter' | 'foregroundExit'>;

/** The event's type, from whichever channel (list, text, system) carries it. */
function eventType(ev: EvenHubEvent): OsEventTypeList | undefined {
  const channels = [ev.listEvent, ev.textEvent, ev.sysEvent].filter((c) => c != null);
  if (channels.length === 0) return undefined;
  const raw = channels.find((c) => c.eventType != null)?.eventType;
  // The host leaves zero-valued fields out, and CLICK_EVENT is 0: a channel that arrives
  // without a type is a tap.
  if (raw == null) return OsEventTypeList.CLICK_EVENT;
  return OsEventTypeList.fromJson(raw) ?? raw;
}

export function toGesture(ev: EvenHubEvent): Gesture | null {
  switch (eventType(ev)) {
    case OsEventTypeList.CLICK_EVENT:
      return 'tap';
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return 'doubleTap';
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return 'swipeUp';
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return 'swipeDown';
    case OsEventTypeList.LONG_PRESS_EVENT:
      return 'longPress';
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return 'longPressRelease';
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return 'foregroundEnter';
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      return 'foregroundExit';
    default:
      return null; // IMU etc.
  }
}
