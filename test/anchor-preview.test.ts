import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anchorPreview } from '../src/search/engine.ts';
import type { ZgHit } from '../src/zg/parse.ts';

function hit(previewLines: ZgHit['previewLines']): ZgHit {
  return {
    rank: 1,
    path: 'a.md',
    startLine: 1,
    endLine: 39,
    rangeLabel: '1-39',
    matchedBy: 'fts+vector',
    group: null,
    heading: 'A',
    headingLevel: 1,
    scope: null,
    stale: false,
    previewLines,
  };
}

describe('anchorPreview', () => {
  const lines = Array.from({ length: 20 }, (_, index) => ({
    line: index + 1,
    text: `filler line ${index + 1}`,
  }));
  lines[9] = { line: 10, text: 'the rocket mention deep in the section' };
  lines[10] = { line: 11, text: 'a following line' };

  it('anchors preview and jump line at the first term match, not the section start', () => {
    const result = anchorPreview(hit(lines), ['rocket']);
    assert.equal(result.line, 10);
    assert.match(result.preview, /rocket mention deep/);
    assert.match(result.preview, /a following line/);
    assert.doesNotMatch(result.preview, /filler line 1\b/);
  });

  it('is case-insensitive', () => {
    const result = anchorPreview(hit(lines), ['ROCKET']);
    assert.equal(result.line, 10);
  });

  it('anchors at the line matching the most distinct terms', () => {
    const dense = hit([
      { line: 1, text: 'alpha rocket early' },
      { line: 2, text: 'deep rocket mention cluster' },
      { line: 3, text: 'tail' },
    ]);
    const result = anchorPreview(dense, ['deep', 'rocket', 'mention']);
    assert.equal(result.line, 2);
    assert.match(result.preview, /deep rocket mention/);
  });

  it('falls back to the window head when no term appears (semantic hits)', () => {
    const result = anchorPreview(hit(lines), ['quantum']);
    assert.equal(result.line, 1);
    assert.match(result.preview, /filler line 1/);
  });

  it('limits the preview to four lines', () => {
    const result = anchorPreview(hit(lines), ['rocket']);
    assert.equal(result.preview.split('\n').length, 4);
  });

  it('strips heading hashes from preview lines', () => {
    const withHeading = hit([
      { line: 1, text: '# Heading start' },
      { line: 2, text: 'body text with needle here' },
    ]);
    const result = anchorPreview(withHeading, ['needle']);
    assert.equal(result.line, 2);
    assert.equal(result.preview.split('\n')[0], 'body text with needle here');
  });

  it('returns empty for a hit without numbered lines', () => {
    const result = anchorPreview(hit([]), ['rocket']);
    assert.equal(result.preview, '');
    assert.equal(result.line, null);
  });
});
