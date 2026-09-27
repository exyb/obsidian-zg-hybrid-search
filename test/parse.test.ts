import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseIndexProgressLine,
  parseIndexSummary,
  parseQueryOutput,
  parseStatusOutput,
  splitPathAndRange,
  unescapeZgText,
} from '../src/zg/parse.ts';

const INDEXED_SAMPLE = `query groups (1):
Q1 [primary]: 配置
hits: 3

#1 matchedBy=fts+vector iwhalecloud/docs/01+规范-V0.5.md:1061-1068
heading: \\### 产品配置模板预览
heading_level: 3
scope: \\# 平台功能要求::\\## 产品配置模板管理
1061\t### \\### 产品配置模板预览
1062\t正文第一行

#2 matchedBy=vector iwhalecloud/docs/02+其他.md:12-19
status: possibly_stale
heading: \\## 产品配置模板发布
heading_level: 2
outline:
12\t概述行
...
13\t续行

#3 matchedBy=fts+vector iwhalecloud/docs/01+规范-V0.5.md:375-384
heading: \\#### 选取产品配置模板
heading_level: 4
375\t#### \\#### 选取产品配置模板`;

describe('parseQueryOutput (indexed)', () => {
  const parsed = parseQueryOutput(INDEXED_SAMPLE);

  it('detects the indexed source', () => {
    assert.equal(parsed.source, 'indexed');
  });

  it('parses the query group header', () => {
    assert.deepEqual(parsed.groups, [{
      id: 'Q1',
      role: 'primary',
      query: '配置',
      hits: 3,
    }]);
  });

  it('parses hit headers with path and range', () => {
    const first = parsed.hits[0];
    assert.equal(first?.path, 'iwhalecloud/docs/01+规范-V0.5.md');
    assert.equal(first?.startLine, 1061);
    assert.equal(first?.endLine, 1068);
    assert.equal(first?.matchedBy, 'fts+vector');
    assert.equal(first?.rank, 1);
  });

  it('unescapes markdown escapes in heading metadata', () => {
    assert.equal(parsed.hits[0]?.heading, '### 产品配置模板预览');
    assert.equal(parsed.hits[0]?.scope, '# 平台功能要求::## 产品配置模板管理');
  });

  it('parses numbered source lines into the preview', () => {
    const first = parsed.hits[0];
    assert.equal(first?.previewLines.length, 2);
    assert.equal(first?.previewLines[0]?.line, 1061);
    assert.equal(first?.previewLines[0]?.text, '### \\### 产品配置模板预览');
  });

  it('tracks the stale flag', () => {
    assert.equal(parsed.hits[0]?.stale, false);
    assert.equal(parsed.hits[1]?.stale, true);
  });

  it('handles outline blocks with ellipsis filler', () => {
    const second = parsed.hits[1];
    assert.equal(second?.previewLines.length, 2);
    assert.equal(second?.previewLines[1]?.line, 13);
  });
});

const RG_SAMPLE = `docs/规范.md
  116-129 [heading \\# 总体方案 > \\## 平台功能架构]
    120:\t产品在线配置工作台。
    126:\t产品配置模板管理。

docs/其他.md
  30-31 [heading \\# 概述]
    30:\t概述正文。`;

describe('parseQueryOutput (rg)', () => {
  const parsed = parseQueryOutput(RG_SAMPLE);

  it('detects the rg source', () => {
    assert.equal(parsed.source, 'rg');
  });

  it('parses file paths and line ranges', () => {
    const first = parsed.hits[0];
    assert.equal(first?.path, 'docs/规范.md');
    assert.equal(first?.startLine, 116);
    assert.equal(first?.endLine, 129);
    assert.equal(first?.matchedBy, 'rg');
  });

  it('parses heading labels with levels', () => {
    assert.equal(parsed.hits[0]?.heading, '## 平台功能架构');
    assert.equal(parsed.hits[0]?.scope, '# 总体方案 › ## 平台功能架构');
  });

  it('parses numbered rg source lines', () => {
    assert.equal(parsed.hits[0]?.previewLines[0]?.line, 120);
    assert.equal(parsed.hits[0]?.previewLines[1]?.text, '产品配置模板管理。');
  });

  it('starts a fresh hit per file block', () => {
    assert.equal(parsed.hits.length, 2);
    assert.equal(parsed.hits[1]?.path, 'docs/其他.md');
    assert.equal(parsed.hits[1]?.startLine, 30);
  });
});

describe('parseQueryOutput (empty)', () => {
  it('parses an empty result without hits', () => {
    const parsed = parseQueryOutput(
      'query groups (1):\nQ1 [primary]: nothing here\nhits: 0\n\nNo matches for any query group.\n',
    );
    assert.equal(parsed.source, 'indexed');
    assert.equal(parsed.hits.length, 0);
    assert.equal(parsed.groups[0]?.hits, 0);
  });
});

describe('splitPathAndRange', () => {
  it('splits line ranges', () => {
    assert.deepEqual(splitPathAndRange('a/b.md:12-20'), {
      path: 'a/b.md',
      startLine: 12,
      endLine: 20,
      rangeLabel: '12-20',
    });
  });
  it('splits single lines', () => {
    assert.deepEqual(splitPathAndRange('a/b.md:7'), {
      path: 'a/b.md',
      startLine: 7,
      endLine: null,
      rangeLabel: '7',
    });
  });
  it('keeps paths containing colons intact', () => {
    assert.equal(splitPathAndRange('C:notes/a.md:3').path, 'C:notes/a.md');
  });
});

describe('parseStatusOutput', () => {
  it('parses a ready status', () => {
    const info = parseStatusOutput(`✓ Workspace index is ready
  /tmp/vault

  Coverage    ████████████████████ 100%  1 / 1 files
  Entities    1
  Truncated   0 fragments
  Queue       0 pending · 0 failed

  Embedding   local/potion-multilingual-128m
              256 dimensions · cosine

  Storage     .zvec-grep/index.zvec`);
    assert.equal(info.state, 'ready');
    assert.equal(info.indexedFiles, 1);
    assert.equal(info.totalFiles, 1);
    assert.equal(info.entities, 1);
    assert.equal(info.model, 'local/potion-multilingual-128m');
    assert.equal(info.pending, 0);
    assert.equal(info.failed, 0);
  });

  it('parses needs-update status with changes', () => {
    const info = parseStatusOutput(`! Workspace index needs an update
  ~/vault

  Coverage    ████████████████████  99%  1,706 / 1,719 files
  Entities    23,471
  Queue       0 pending · 0 failed
  Changes     3 added · 10 modified · 2 deleted

  Embedding   local/potion-code-16m-v2`);
    assert.equal(info.state, 'needs-update');
    assert.equal(info.indexedFiles, 1706);
    assert.equal(info.totalFiles, 1719);
    assert.equal(info.changes, '3 added · 10 modified · 2 deleted');
  });

  it('parses unconfigured status', () => {
    const info = parseStatusOutput(`? Workspace index is not configured
  /tmp/empty

  Storage     .zvec-grep/index.zvec
  Policy      undecided`);
    assert.equal(info.state, 'unconfigured');
  });
});

describe('parseIndexProgressLine', () => {
  it('parses model download progress', () => {
    const progress = parseIndexProgressLine(
      'Downloading local/potion-multilingual-128m · 40% · 203 MiB/506 MiB',
    );
    assert.equal(progress?.phase, 'downloading-model');
    assert.equal(progress?.percent, 40);
    assert.match(progress?.message ?? '', /40%/);
  });

  it('recognises scan and completion phases', () => {
    assert.equal(parseIndexProgressLine('Scanning files...')?.phase, 'scanning');
    assert.equal(parseIndexProgressLine('Indexing complete')?.phase, 'complete');
  });

  it('ignores tips and noise', () => {
    assert.equal(parseIndexProgressLine('tip\tDefault indexing skips noise.'), null);
    assert.equal(parseIndexProgressLine(''), null);
  });
});

describe('parseIndexSummary', () => {
  it('extracts the trailing summary table', () => {
    const summary = parseIndexSummary(`Indexing complete
Workspace index
files\t1719 scanned, 3 added, 10 modified, 0 retried, 1706 unchanged, 2 deleted, 0 failed
entities\t583
duration\t11s (11153ms)
roots\t/tmp/vault`);
    assert.match(summary.files ?? '', /2 deleted, 0 failed/);
    assert.equal(summary.entities, '583');
    assert.equal(summary.duration, '11s (11153ms)');
  });
});

describe('unescapeZgText', () => {
  it('unescapes markdown punctuation', () => {
    assert.equal(unescapeZgText('\\# Title \\_sub\\*'), '# Title _sub*');
    assert.equal(unescapeZgText('plain text'), 'plain text');
  });
});
