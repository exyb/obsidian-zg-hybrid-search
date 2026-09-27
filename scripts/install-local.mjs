/**
 * Copies the built plugin into a vault's plugin folder:
 *   node scripts/install-local.mjs /path/to/vault
 * Build first with `npm run build`.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const vaultArg = process.argv[2];
if (!vaultArg) {
  console.error('Usage: node scripts/install-local.mjs /path/to/vault');
  process.exit(1);
}

const pluginDir = join(
  resolve(vaultArg),
  '.obsidian',
  'plugins',
  'zg-hybrid-search',
);
mkdirSync(pluginDir, { recursive: true });

const files = ['main.js', 'manifest.json', 'styles.css'];
for (const file of files) {
  copyFileSync(join(process.cwd(), file), join(pluginDir, file));
}
console.log(`Installed ${files.join(', ')} to ${pluginDir}`);
console.log('Restart Obsidian, then enable "ZG Hybrid Search" in Settings → Community plugins.');
