// URL parameters for development and for the simulator check (scripts/sim-verify.ts).
//
//   ?mock=1    demo data instead of the feed
//   ?reset=1   start from a clean slate: forget settings, read marks, saved topics and
//              the feed cache (applies on every load while it is in the URL)
//   ?debug=1   print what the lens shows to the console after every draw, and follow
//              navigation commands from the dev server (see main.ts)
//   ?ctl=URL   which dev server to follow, for the built app
//   ?feed=URL  feed relay base

const params = new URLSearchParams(location.search);

export const param = (name: string): string => params.get(name) ?? '';
export const isMock = param('mock') === '1';
export const isReset = param('reset') === '1';
export const isDebug = param('debug') === '1';
