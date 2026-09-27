import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * How to invoke zg: either the executable directly, or an explicit node
 * interpreter plus the resolved zg CLI entry script. The npm `zg` launcher is
 * a JavaScript file with a `#!/usr/bin/env node` shebang, so a node binary
 * must be resolvable by the spawned process — Obsidian's own PATH is not
 * guaranteed to contain one (nvm installs usually do not).
 */
export interface Toolchain {
  command: string;
  /** Arguments inserted before every zg subcommand. */
  prefixArgs: string[];
  /** Human-readable path of the zg CLI entry used. */
  zgPath: string;
  version: string;
}

export class ToolchainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolchainError';
  }
}

const ZG_SCRIPT_HINT = '@zvec/zvec-grep/dist/cli/index.js';

export async function resolveToolchain(explicitPath: string): Promise<Toolchain> {
  const zgPath = await resolveZgPath(explicitPath);
  const invocation = invocationFor(zgPath);
  const version = await probeVersion(invocation);
  return {
    command: invocation.command,
    prefixArgs: invocation.prefixArgs,
    zgPath,
    version,
  };
}

async function resolveZgPath(explicitPath: string): Promise<string> {
  const candidates: string[] = [];
  if (explicitPath.trim()) {
    candidates.push(explicitPath.trim());
  } else {
    candidates.push(...pathCandidates('zg'));
  }
  for (const candidate of candidates) {
    const resolved = firstExisting([candidate, `${candidate}.js`]);
    if (resolved) return resolved;
  }
  throw new ToolchainError(
    'The zg CLI was not found. Install it with `npm install -g @zvec/zvec-grep` '
      + '(requires Node.js 22+), or set its path under Settings → ZG Hybrid Search.',
  );
}

interface Invocation {
  command: string;
  prefixArgs: string[];
}

function invocationFor(zgPath: string): Invocation {
  if (isExecutableScript(zgPath)) {
    const node = firstExisting(pathCandidates('node'));
    if (node) {
      return { command: node, prefixArgs: [realpathSync(zgPath)] };
    }
    // Fall back to executing the script; its shebang must resolve node itself.
    return { command: zgPath, prefixArgs: [] };
  }
  if (/\.cmd$/i.test(zgPath)) {
    // Windows npm shim: prefer the package entry so we can avoid shell:true.
    const packaged = firstExisting([
      join(dirname(zgPath), '..', 'lib', 'node_modules', ZG_SCRIPT_HINT),
      join(dirname(zgPath), 'node_modules', ZG_SCRIPT_HINT),
    ]);
    const node = firstExisting(pathCandidates('node'));
    if (packaged && node) {
      return { command: node, prefixArgs: [packaged] };
    }
  }
  return { command: zgPath, prefixArgs: [] };
}

function isExecutableScript(path: string): boolean {
  try {
    const head = readFileSync(path, 'utf8').slice(0, 160);
    return head.startsWith('#!');
  } catch {
    return false;
  }
}

function pathCandidates(name: string): string[] {
  const candidates: string[] = [];
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(delimiter())) {
    if (dir) candidates.push(join(dir, name));
  }
  const home = homedir();
  candidates.push(
    // nvm node/zg live outside the PATH of GUI-launched apps.
    join(home, '.nvm', 'versions', 'node'),
    '/usr/local/bin',
    '/usr/bin',
    '/opt/homebrew/bin',
    join(home, '.local', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, 'bin'),
    join(home, '.npm-global', 'bin'),
  );
  return expandNvm(candidates, name);
}

function expandNvm(candidates: string[], name: string): string[] {
  const expanded: string[] = [];
  for (const candidate of candidates) {
    if (candidate.endsWith(join('.nvm', 'versions', 'node'))) {
      const dir = candidate;
      let versions: string[] = [];
      try {
        versions = readdirSync(dir)
          .filter((entry) => entry.startsWith('v'))
          .sort(compareVersions)
          .reverse();
      } catch {
        versions = [];
      }
      for (const version of versions) {
        expanded.push(join(dir, version, 'bin', name));
      }
    } else {
      expanded.push(candidate);
    }
  }
  return expanded;
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function delimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

function firstExisting(paths: readonly string[]): string | null {
  for (const path of paths) {
    try {
      const resolved = resolve(path);
      if (existsSync(resolved) && statSync(resolved).isFile()) {
        return resolved;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function probeVersion(invocation: Invocation): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    try {
      const stdout = execFileSync(
        invocation.command,
        [...invocation.prefixArgs, '--version'],
        { encoding: 'utf8', timeout: 15_000, windowsHide: true },
      );
      const match = stdout.match(/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
      resolvePromise(match?.[1] ?? stdout.trim());
    } catch (error) {
      reject(new ToolchainError(
        `zg was found but could not be started: ${
          (error as Error)?.message ?? String(error)
        }`,
      ));
    }
  });
}
