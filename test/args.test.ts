import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDropIndexArgs,
  buildIncrementalIndexArgs,
  buildQueryArgs,
} from '../src/zg/args.ts';
import { DEFAULT_SETTINGS, type SearchRequest } from '../src/types.ts';

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: 'test query',
    mode: 'hybrid',
    matchMode: 'terms',
    sort: 'relevance',
    grouping: 'notes',
    limit: 20,
    ...overrides,
  };
}

describe('buildQueryArgs', () => {
  it('builds a hybrid query with limit, preview and direct mode', () => {
    const args = buildQueryArgs(request(), DEFAULT_SETTINGS);
    assert.deepEqual(args, [
      'query',
      'test query',
      '--limit', '20',
      '--preview', 'full',
      '--mode', 'direct',
      '-g', '!.trash/**',
    ]);
  });

  it('routes keyword mode through --fts and semantic through --vector', () => {
    assert.ok(buildQueryArgs(request({ mode: 'keyword' }), DEFAULT_SETTINGS)
      .includes('--fts'));
    assert.ok(buildQueryArgs(request({ mode: 'semantic' }), DEFAULT_SETTINGS)
      .includes('--vector'));
  });

  it('routes phrase matching through managed rg with -F', () => {
    const args = buildQueryArgs(
      request({ matchMode: 'phrase', query: 'exact phrase' }),
      DEFAULT_SETTINGS,
    );
    const ftsIndex = args.indexOf('--rg');
    assert.ok(ftsIndex >= 0);
    assert.deepEqual(args.slice(ftsIndex, ftsIndex + 3), ['--rg', '-F', 'exact phrase']);
    // rg mode applies include globs too.
    assert.ok(args.includes('*.md'));
  });

  it('applies date filters when provided', () => {
    const args = buildQueryArgs(
      request({ modifiedFrom: 1000, modifiedTo: 2000 }),
      DEFAULT_SETTINGS,
    );
    assert.ok(args.includes('--modified-after'));
    assert.ok(args.includes('--modified-before'));
  });

  it('passes custom include and exclude globs', () => {
    const args = buildQueryArgs(request(), {
      includeGlobs: ['*.md', 'Notes/**'],
      excludeGlobs: ['Archive/**'],
    });
    // Hybrid mode: excludes as -g '!...'; includes only matter for rg mode.
    assert.ok(args.includes('!Archive/**'));
    const phrase = buildQueryArgs(request({ matchMode: 'phrase' }), {
      includeGlobs: ['*.md', 'Notes/**'],
      excludeGlobs: ['Archive/**'],
    });
    assert.ok(phrase.includes('Notes/**'));
    assert.ok(phrase.includes('!Archive/**'));
  });
});

describe('buildIncrementalIndexArgs', () => {
  it('embeds the model, device and file selection', () => {
    const args = buildIncrementalIndexArgs({
      ...DEFAULT_SETTINGS,
      embeddingModel: 'local/potion-retrieval-32m',
      device: 'cpu',
      includeGlobs: ['*.md'],
      excludeGlobs: ['.trash/**', 'Archive/**'],
    });
    assert.deepEqual(args, [
      'index',
      '--embedding', 'local/potion-retrieval-32m',
      '--mode', 'direct',
      '--device', 'cpu',
      '-g', '*.md',
      '-g', '!.trash/**',
      '-g', '!Archive/**',
    ]);
  });

  it('passes the model cache when configured', () => {
    const args = buildIncrementalIndexArgs({
      ...DEFAULT_SETTINGS,
      modelCachePath: '/tmp/models',
    });
    const cacheIndex = args.indexOf('--model-cache');
    assert.ok(cacheIndex >= 0);
    assert.equal(args[cacheIndex + 1], '/tmp/models');
  });
});

describe('buildDropIndexArgs', () => {
  it('drops without prompting', () => {
    assert.deepEqual(buildDropIndexArgs(), ['index', '--drop', '--yes']);
  });
});
