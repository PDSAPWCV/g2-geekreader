// `npm run pack`: build an .ehpk whose network whitelist allows the feed relay the build
// talks to. app.json in the repository only holds a placeholder; the real address comes
// from VITE_FEED_BASE (`.env.production.local`, not in git), the same value `vite build`
// compiles into the app. The filled-in manifest is written to .pack/ and packed from there.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from 'vite';

const PLACEHOLDER = 'REPLACE-ME';
const OUT = 'g2-geekreader.ehpk';

const base = loadEnv('production', process.cwd(), 'VITE_').VITE_FEED_BASE?.trim() ?? '';
let origin = '';
try {
  origin = new URL(base).origin;
} catch {
  /* reported below */
}
// URL() lowercases the host, so compare the placeholder case-insensitively.
if (!origin.startsWith('https://') || origin.includes(PLACEHOLDER.toLowerCase())) {
  console.error(`VITE_FEED_BASE is "${base}". Put the deployed Worker address in .env.production.local (see .env.example).`);
  process.exit(1);
}

interface Permission {
  name: string;
  whitelist?: string[];
}
const manifest = JSON.parse(readFileSync('app.json', 'utf8')) as { permissions?: Permission[] };
const network = manifest.permissions?.find((p) => p.name === 'network');
if (!network?.whitelist?.some((u) => u.includes(PLACEHOLDER))) {
  console.error(`app.json: no network whitelist entry with ${PLACEHOLDER} to fill in`);
  process.exit(1);
}
network.whitelist = network.whitelist.map((u) => (u.includes(PLACEHOLDER) ? origin : u));

mkdirSync('.pack', { recursive: true });
writeFileSync('.pack/app.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`network whitelist: ${network.whitelist.join(', ')}`);

const r = spawnSync('npx', ['evenhub', 'pack', '.pack/app.json', 'dist', '-o', OUT], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
