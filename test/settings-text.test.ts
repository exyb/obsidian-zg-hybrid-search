import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  basenameWithoutExtension,
  queryTerms,
} from '../src/search/text.ts';
import {
  normalizeSettings,
  parseGlobList,
} from '../src/settings.ts';
import { DEFAULT_SETTINGS } from '../src/types.ts';

describe('queryTerms', () => {
  it('splits on whitespace and CJK punctuation', () => {
    assert.deepEqual(queryTerms('hello world'), ['hello', 'world']);
    assert.deepEqual(queryTerms('配置 模板，发布'), ['配置', '模板', '发布']);
  });

  it('strips wrapping punctuation', () => {
    assert.deepEqual(queryTerms('"quoted term"'), ['quoted', 'term']);
  });

  it('keeps the raw phrase when only punctuation remains', () => {
    assert.deepEqual(queryTerms('C++'), ['C++']);
  });

  it('returns an empty list for empty input', () => {
    assert.deepEqual(queryTerms('   '), []);
  });
});

describe('basenameWithoutExtension', () => {
  it('strips the extension', () => {
    assert.equal(basenameWithoutExtension('a/b/note.md'), 'note');
  });
  it('keeps dotfiles intact', () => {
    assert.equal(basenameWithoutExtension('.gitignore'), '.gitignore');
  });
});

describe('parseGlobList', () => {
  it('splits lines, trims and strips ! prefixes', () => {
    assert.deepEqual(parseGlobList('*.md\n!Archive/**\n\n  .trash/**  '), [
      '*.md',
      'Archive/**',
      '.trash/**',
    ]);
  });

  it('ignores comment lines', () => {
    assert.deepEqual(parseGlobList('# comment\n*.md'), ['*.md']);
  });
});

describe('normalizeSettings', () => {
  it('falls back to defaults for garbage input', () => {
    assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(normalizeSettings('nope'), DEFAULT_SETTINGS);
  });

  it('clamps numeric settings to their ranges', () => {
    const settings = normalizeSettings({ resultLimit: 999, queryLimit: -5, quietPeriodMs: 1 });
    assert.equal(settings.resultLimit, 100);
    assert.equal(settings.queryLimit, 1);
    assert.equal(settings.quietPeriodMs, 1000);
  });

  it('normalizes glob lists and keeps valid values', () => {
    const settings = normalizeSettings({
      includeGlobs: ['*.md', '*.md', ''],
      excludeGlobs: 'not-an-array',
    });
    assert.deepEqual(settings.includeGlobs, ['*.md']);
    assert.deepEqual(settings.excludeGlobs, DEFAULT_SETTINGS.excludeGlobs);
  });

  it('preserves a custom embedding model and zg path', () => {
    const settings = normalizeSettings({
      embeddingModel: 'local/multilingual-e5-small',
      zgPath: '/opt/zg/bin/zg',
    });
    assert.equal(settings.embeddingModel, 'local/multilingual-e5-small');
    assert.equal(settings.zgPath, '/opt/zg/bin/zg');
  });
});
