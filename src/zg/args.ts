import type { HybridSearchSettings, SearchRequest } from '../types';

export function buildQueryArgs(
  request: SearchRequest,
  settings: Pick<
    HybridSearchSettings,
    'includeGlobs' | 'excludeGlobs'
  >,
): string[] {
  const args: string[] = ['query'];
  const exclude = settings.excludeGlobs.map((glob) => `!${glob}`);

  if (request.matchMode === 'phrase') {
    // Exact-phrase matching routes through managed ripgrep over the vault.
    args.push('--rg', '-F', request.query);
    for (const glob of settings.includeGlobs) args.push('-g', glob);
    for (const glob of exclude) args.push('-g', glob);
  } else {
    if (request.mode === 'keyword') args.push('--fts', request.query);
    else if (request.mode === 'semantic') args.push('--vector', request.query);
    else args.push(request.query);
    args.push(
      '--limit',
      String(request.limit),
      // Full section text with line numbers; the engine picks the preview
      // window anchored at the first line matching the query terms, since zg
      // reports the whole section as the hit range for long sections.
      '--preview',
      'full',
      '--mode',
      'direct',
    );
    for (const glob of exclude) args.push('-g', glob);
  }
  if (request.modifiedFrom !== undefined) {
    args.push('--modified-after', String(request.modifiedFrom));
  }
  if (request.modifiedTo !== undefined) {
    args.push('--modified-before', String(request.modifiedTo));
  }
  return args;
}

export function buildIncrementalIndexArgs(
  settings: HybridSearchSettings,
): string[] {
  return [
    'index',
    '--embedding',
    settings.embeddingModel,
    '--mode',
    'direct',
    '--device',
    settings.device,
    ...modelCacheArgs(settings),
    ...fileSelectionArgs(settings),
  ];
}

export function buildDropIndexArgs(): string[] {
  return ['index', '--drop', '--yes'];
}

function modelCacheArgs(
  settings: Pick<HybridSearchSettings, 'modelCachePath'>,
): string[] {
  return settings.modelCachePath.trim()
    ? ['--model-cache', settings.modelCachePath.trim()]
    : [];
}

function fileSelectionArgs(
  settings: Pick<HybridSearchSettings, 'includeGlobs' | 'excludeGlobs'>,
): string[] {
  const args: string[] = [];
  for (const glob of settings.includeGlobs) args.push('-g', glob);
  for (const glob of settings.excludeGlobs) args.push('-g', `!${glob}`);
  return args;
}
