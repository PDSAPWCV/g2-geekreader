// Diagnostics shown at the bottom of the phone page. The Even app's WebView has no
// devtools, so feed requests, lens events and errors are collected here as well as in
// the console.

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  text: string;
}

const KEEP = 300;
const entries: LogEntry[] = [];
const changes = new EventTarget();

function announce(): void {
  changes.dispatchEvent(new Event('change'));
}

export function log(text: string, level: LogLevel = 'info'): void {
  entries.push({ at: Date.now(), level, text });
  if (entries.length > KEEP) entries.splice(0, entries.length - KEEP);
  announce();
}

export const logEntries = (): readonly LogEntry[] => entries;

export function clearLog(): void {
  entries.splice(0);
  announce();
}

export function onLog(listener: () => void): () => void {
  changes.addEventListener('change', listener);
  return () => changes.removeEventListener('change', listener);
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let mirroring = false;

/** Copy console.log / warn / error and uncaught errors into this log (idempotent). */
export function mirrorConsole(): void {
  if (mirroring) return;
  mirroring = true;
  const methods = { log: 'info', warn: 'warn', error: 'error' } as const;
  for (const [method, level] of Object.entries(methods) as [keyof typeof methods, LogLevel][]) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      log(args.map(describe).join(' '), level);
      original(...args);
    };
  }
  addEventListener('error', (e) => log(`uncaught: ${e.message}`, 'error'));
  addEventListener('unhandledrejection', (e) => log(`unhandled rejection: ${describe(e.reason)}`, 'error'));
}
