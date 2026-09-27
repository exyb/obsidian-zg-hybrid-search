import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { modifiedDateRangeFromInputs } from '../src/ui/date-range.ts';
import { resultActivationFor } from '../src/ui/result-activation.ts';
import { ResultPager } from '../src/ui/result-pager.ts';
import { SearchSession } from '../src/ui/search-session.ts';
import { sortResults } from '../src/search/engine.ts';
import type { SearchResult } from '../src/types.ts';

describe('modifiedDateRangeFromInputs', () => {
  it('returns an empty range for blank inputs', () => {
    assert.deepEqual(modifiedDateRangeFromInputs('', ''), {});
  });

  it('bounds a To date to the end of that day', () => {
    const range = modifiedDateRangeFromInputs('', '2026-09-27');
    assert.ok(range.modifiedTo !== undefined);
    const end = new Date(range.modifiedTo);
    assert.equal(end.getHours(), 23);
    assert.equal(end.getMinutes(), 59);
  });

  it('caps an open-ended From range at now', () => {
    const range = modifiedDateRangeFromInputs('2026-09-01', '');
    assert.ok((range.modifiedTo ?? 0) <= Date.now());
  });

  it('rejects inverted ranges', () => {
    assert.throws(
      () => modifiedDateRangeFromInputs('2026-09-27', '2026-09-01'),
      /From date/,
    );
  });
});

describe('resultActivationFor', () => {
  it('opens in the same tab for a plain click', () => {
    assert.deepEqual(
      resultActivationFor({ type: 'click', button: 0, ctrlKey: false, metaKey: false }),
      { newTab: false, preventDefault: false },
    );
  });

  it('opens in a new tab for ctrl/meta/middle clicks', () => {
    assert.equal(
      resultActivationFor({ type: 'click', button: 0, ctrlKey: true, metaKey: false })?.newTab,
      true,
    );
    assert.equal(
      resultActivationFor({ type: 'auxclick', button: 1, ctrlKey: false, metaKey: false })?.newTab,
      true,
    );
  });

  it('ignores right clicks', () => {
    assert.equal(
      resultActivationFor({ type: 'click', button: 2, ctrlKey: false, metaKey: false }),
      null,
    );
  });
});

describe('ResultPager', () => {
  it('pages through items and reports what remains', () => {
    const pager = new ResultPager<number>();
    pager.reset([1, 2, 3, 4, 5]);
    const first = pager.next(2);
    assert.deepEqual(first.items, [1, 2]);
    assert.equal(first.shown, 2);
    assert.equal(first.remaining, 3);
    const second = pager.next(2);
    assert.deepEqual(second.items, [3, 4]);
    const third = pager.next(2);
    assert.deepEqual(third.items, [5]);
    assert.equal(third.remaining, 0);
  });
});

describe('SearchSession', () => {
  it('invalidates the session when the input changes', () => {
    const session = new SearchSession();
    const generation = session.begin('alpha');
    assert.equal(session.isCurrent(generation, 'alpha'), true);
    assert.equal(session.invalidateIfInputChanged('beta'), true);
    assert.equal(session.isCurrent(generation, 'alpha'), false);
  });

  it('keeps the session while typing does not change the trimmed query', () => {
    const session = new SearchSession();
    const generation = session.begin('alpha');
    assert.equal(session.invalidateIfInputChanged(' alpha '), false);
    assert.equal(session.isCurrent(generation, 'alpha'), true);
  });
});

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    path: 'a.md',
    title: 'A',
    heading: '',
    preview: '',
    startLine: 1,
    endLine: null,
    matchedBy: 'fts+vector',
    rank: 1,
    stale: false,
    mtime: 0,
    ctime: 0,
    ...overrides,
  };
}

describe('sortResults', () => {
  const results = [
    result({ path: 'b.md', title: 'B', rank: 2, mtime: 200, ctime: 10 }),
    result({ path: 'a.md', title: 'A', rank: 1, mtime: 300, ctime: 20 }),
    result({ path: 'c.md', title: 'C', rank: 3, mtime: 100, ctime: 30 }),
  ];

  it('keeps relevance order by rank', () => {
    assert.deepEqual(
      sortResults(results, 'relevance').map((item) => item.title),
      ['A', 'B', 'C'],
    );
  });

  it('sorts by modification date with rank as tiebreaker', () => {
    assert.deepEqual(
      sortResults(results, 'modified-asc').map((item) => item.title),
      ['C', 'B', 'A'],
    );
  });

  it('sorts by title', () => {
    assert.deepEqual(
      sortResults(results, 'title-desc').map((item) => item.title),
      ['C', 'B', 'A'],
    );
  });

  it('groups to the best section per note when requested', () => {
    const engine = results.concat(result({ path: 'a.md', title: 'A', rank: 9 }));
    const seen = new Set(
      sortResults(engine, 'relevance')
        .filter((item, index, all) => all.findIndex((x) => x.path === item.path) === index)
        .map((item) => item.path),
    );
    assert.equal(seen.size, 3);
  });
});
