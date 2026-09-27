/**
 * Smoke test against the real zg binary. Run with:
 *   node --import tsx scripts/smoke.ts
 * Uses a synthetic vault under /tmp; requires `zg` to be installed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveToolchain } from '../src/zg/locate.ts';
import { ZgRunner, assertOk } from '../src/zg/runner.ts';
import { ZgSearchEngine } from '../src/search/engine.ts';
import { IndexManager } from '../src/indexing/index-manager.ts';
import {
  DEFAULT_SETTINGS,
  type HybridSearchSettings,
  type IndexStatus,
} from '../src/types.ts';

const quiet = (message: string): void => console.log(`[smoke] ${message}`);

const vault = mkdtempSync(join(tmpdir(), 'zg-plugin-smoke-'));
quiet(`vault: ${vault}`);

writeFileSync(join(vault, 'rockets.md'), `# Rockets

A rocket is a vehicle that uses jet propulsion to accelerate
without using the surrounding air.

## Launch sequence

The launch sequence begins with ignition of the first stage.
`);

writeFileSync(join(vault, 'gardening.md'), `# Gardening notes

Tomatoes need full sun and regular watering.
Rockets appear in garden names surprisingly often.
`);

mkdirSync(join(vault, '.trash'), { recursive: true });
writeFileSync(join(vault, '.trash', 'junk.md'), 'obsolete rockets draft');

const settings: HybridSearchSettings = {
  ...DEFAULT_SETTINGS,
  embeddingModel: 'local/potion-multilingual-128m',
};

const toolchain = await resolveToolchain(settings.zgPath);
quiet(`zg ${toolchain.version} at ${toolchain.zgPath}`);

const runner = new ZgRunner(() => Promise.resolve(toolchain));
const statusRef: { current: IndexStatus | null } = { current: null };
const manager = new IndexManager({
  runner,
  vaultRoot: vault,
  getSettings: () => settings,
  publish: (status) => {
    statusRef.current = status;
    console.log(`[smoke] status: ${status.phase} — ${status.message}`);
  },
});

quiet('building initial index…');
await manager.runIncremental(false);
if (statusRef.current?.phase === 'error') {
  throw new Error(`index build failed: ${statusRef.current.error}`);
}

const statFor = (path: string) => {
  const now = new Date('2026-09-27T12:00:00');
  return { mtime: now.getTime(), ctime: now.getTime(), title: path.replace(/\.md$/, '') };
};
const engine = new ZgSearchEngine(
  runner,
  vault,
  () => settings,
  statFor,
);

let failures = 0;
async function expectHits(
  label: string,
  request: Parameters<ZgSearchEngine['search']>[0],
  predicate: (paths: string[], titles: string[]) => boolean,
): Promise<void> {
  const response = await engine.search(request);
  const paths = response.results.map((result) => result.path);
  const titles = response.results.map((result) => result.title);
  const ok = predicate(paths, titles);
  quiet(
    `${ok ? 'PASS' : 'FAIL'} ${label}: ${response.total} hits (${response.elapsedMs}ms) `
      + `${JSON.stringify(response.results.slice(0, 3).map((r) => [r.path, r.startLine, r.matchedBy]))}`,
  );
  if (!ok) failures += 1;
}

await expectHits(
  'hybrid finds rockets.md first',
  { query: 'rocket launch ignition', mode: 'hybrid', matchMode: 'terms', sort: 'relevance', grouping: 'notes', limit: 10 },
  (paths) => paths[0] === 'rockets.md',
);

await expectHits(
  'keyword mode works',
  { query: 'tomatoes', mode: 'keyword', matchMode: 'terms', sort: 'relevance', grouping: 'notes', limit: 10 },
  (paths) => paths.includes('gardening.md'),
);

await expectHits(
  'semantic mode works',
  { query: 'space vehicle propulsion', mode: 'semantic', matchMode: 'terms', sort: 'relevance', grouping: 'passages', limit: 10 },
  (paths) => paths.includes('rockets.md'),
);

await expectHits(
  'phrase mode uses rg',
  { query: 'launch sequence', mode: 'hybrid', matchMode: 'phrase', sort: 'relevance', grouping: 'notes', limit: 10 },
  (paths) => paths.includes('rockets.md'),
);

await expectHits(
  '.trash is excluded',
  { query: 'rockets draft', mode: 'hybrid', matchMode: 'terms', sort: 'relevance', grouping: 'notes', limit: 10 },
  (paths) => !paths.some((path) => path.includes('.trash')),
);

await expectHits(
  'date filter modified-after future returns nothing',
  { query: 'rocket', mode: 'hybrid', matchMode: 'terms', sort: 'relevance', grouping: 'notes', limit: 10, modifiedFrom: Date.now() + 86_400_000 },
  (paths) => paths.length === 0,
);

quiet('incremental: adding a new note…');
writeFileSync(join(vault, 'quantum.md'), `# Quantum tuning

Quantum tuning explains why rockets hum inecen harmonic resonance.
`);
const future = new Date();
utimesSync(join(vault, 'quantum.md'), future, future);
await manager.runIncremental(false);

await expectHits(
  'incremental index picks up the new note',
  { query: 'quantum tuning resonance', mode: 'hybrid', matchMode: 'terms', sort: 'relevance', grouping: 'notes', limit: 10 },
  (paths) => paths.includes('quantum.md'),
);

quiet('rebuild flow…');
await manager.rebuild();
const status = await manager.refreshStatus();
quiet(`final status: ${status.state} files=${status.indexedFiles}/${status.totalFiles}`);
if (status.state !== 'ready') failures += 1;
if (status.totalFiles !== 3) {
  quiet(`FAIL expected 3 indexed files, got ${status.totalFiles}`);
  failures += 1;
}

quiet('drop index…');
const drop = await runner.run(['index', '--drop', '--yes'], { cwd: vault, timeoutMs: 60_000 });
assertOk(drop, 'drop index');

runner.cancelAll();
rmSync(vault, { recursive: true, force: true });

if (failures > 0) {
  console.error(`[smoke] ${failures} FAILURES`);
  process.exit(1);
}
console.log('[smoke] ALL PASSED');
