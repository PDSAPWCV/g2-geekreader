// The Even app bridge. Every module asks for it here, so the SDK waits for it only once.

import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk';

let ready: Promise<EvenAppBridge> | undefined;

export function bridge(): Promise<EvenAppBridge> {
  ready ??= waitForEvenAppBridge();
  return ready;
}
