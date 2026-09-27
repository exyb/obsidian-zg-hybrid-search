/**
 * Parsers for zg's agent-markdown CLI output (`zg query`, `zg status`,
 * `zg index`). The formats are documented by zvec-grep's
 * `src/cli/format/context.ts`; when zg gains a machine-readable output mode
 * these parsers are the only code that needs to change.
 */

export interface ZgHit {
  rank: number;
  path: string;
  startLine: number;
  endLine: number | null;
  rangeLabel: string;
  matchedBy: string;
  group: string | null;
  heading: string | null;
  headingLevel: number | null;
  scope: string | null;
  stale: boolean;
  previewLines: { line: number | null; text: string }[];
}

export interface ZgQueryGroup {
  id: string;
  role: string;
  query: string;
  hits: number;
}

export interface ParsedQuery {
  source: 'indexed' | 'rg';
  groups: ZgQueryGroup[];
  hits: ZgHit[];
}

const ITEM_HEADER = /^#(\d+)(?:\s+\[[^\]]*\])?\s+matchedBy=(\S+)\s+(.+)$/;
const GROUP_HEADER = /^(Q\d+) \[([a-z-]+)\]: (.*)$/;
const HITS_LINE = /^hits: (\d+)$/;
const SOURCE_LINE_RG = /^ +(\d+)([:-])\t(.*)$/;
const RG_BLOCK = /^ {2}(\d+)(?:-(\d+))? \[(.+)\](?: (.*))?$/;

const ITEM_KEYS = new Set([
  'groups:',
  'status:',
  'heading:',
  'heading_level:',
  'scope:',
  'symbol:',
  'outline:',
  'matched:',
  'source:',
  'trace:',
]);
const FOOTER_KEYS = new Set([
  'status:',
  'results:',
  'background_refresh:',
  'selection:',
]);

/** zg escapes markdown-significant characters in metadata with backslashes. */
export function unescapeZgText(value: string): string {
  return value.replace(/\\([#>[\]_*`\\])/g, '$1');
}

export function parseQueryOutput(text: string): ParsedQuery {
  const lines = text.split(/\r?\n/);
  // Indexed output always prints a "query groups (n):" header (even for zero
  // hits); managed rg output prints bare file paths with indented blocks.
  const looksIndexed = /^query groups \(/m.test(text)
    || ITEM_HEADER.test(findFirstNonEmpty(lines) ?? '');
  return looksIndexed ? parseIndexedOutput(lines) : parseRgOutput(lines);
}

function findFirstNonEmpty(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (line.trim()) return line;
  }
  return null;
}

function parseIndexedOutput(lines: readonly string[]): ParsedQuery {
  const groups: ZgQueryGroup[] = [];
  const hits: ZgHit[] = [];
  let currentHit: ZgHit | null = null;
  /** Metadata comes before content; once content starts, only numbered source
   * lines belong to the item and anything else closes it. */
  let inContent = false;
  let sawSourceLine = false;
  let pendingGroup: { id: string; role: string; query: string } | null = null;

  const closeHit = (): void => {
    if (currentHit) hits.push(currentHit);
    currentHit = null;
    inContent = false;
    sawSourceLine = false;
  };

  for (const line of lines) {
    const groupMatch = line.match(GROUP_HEADER);
    if (groupMatch) {
      closeHit();
      pendingGroup = {
        id: groupMatch[1] ?? '',
        role: groupMatch[2] ?? '',
        query: groupMatch[3] ?? '',
      };
      continue;
    }
    const hitsMatch = line.match(HITS_LINE);
    if (hitsMatch && pendingGroup) {
      groups.push({ ...pendingGroup, hits: Number(hitsMatch[1]) || 0 });
      pendingGroup = null;
      continue;
    }

    const headerMatch = line.match(ITEM_HEADER);
    if (headerMatch) {
      closeHit();
      const located = splitPathAndRange(headerMatch[3] ?? '');
      currentHit = {
        rank: Number(headerMatch[1]) || hits.length + 1,
        path: located.path,
        startLine: located.startLine,
        endLine: located.endLine,
        rangeLabel: located.rangeLabel,
        matchedBy: headerMatch[2] ?? '',
        group: lastGroupId(groups),
        heading: null,
        headingLevel: null,
        scope: null,
        stale: false,
        previewLines: [],
      };
      continue;
    }
    if (!currentHit) {
      continue;
    }

    if (inContent) {
      const numbered = line.match(/^(\d+)\t(.*)$/);
      if (numbered) {
        sawSourceLine = true;
        currentHit.previewLines.push({
          line: Number(numbered[1]),
          text: numbered[2] ?? '',
        });
        continue;
      }
      const unnumbered = line.match(/^\t(.*)$/);
      if (unnumbered) {
        currentHit.previewLines.push({ line: null, text: unnumbered[1] ?? '' });
        continue;
      }
      if (line === '...' || line.trim() === '') continue;
      if (!sawSourceLine) continue; // outline filler before numbered source
      // Anything else after real source lines ends the item (footer follows).
      closeHit();
      continue;
    }

    if (line.startsWith('outline:')) {
      inContent = true;
      continue;
    }
    if (line.startsWith('source:')) {
      inContent = true;
      continue;
    }
    if (line.startsWith('heading_level:')) {
      const level = Number(line.slice('heading_level:'.length).trim());
      currentHit.headingLevel = Number.isFinite(level) ? level : null;
      continue;
    }
    if (line.startsWith('heading:')) {
      currentHit.heading = unescapeZgText(
        line.slice('heading:'.length).trim(),
      );
      continue;
    }
    if (line.startsWith('scope:')) {
      currentHit.scope = unescapeZgText(line.slice('scope:'.length).trim());
      continue;
    }
    if (line === 'status: possibly_stale') {
      currentHit.stale = true;
      continue;
    }
    if (line.startsWith('groups:') || line.startsWith('symbol:')
      || line.startsWith('matched:') || line.startsWith('trace:')) {
      continue;
    }
    const numbered = line.match(/^(\d+)\t(.*)$/);
    if (numbered) {
      inContent = true;
      sawSourceLine = true;
      currentHit.previewLines.push({
        line: Number(numbered[1]),
        text: numbered[2] ?? '',
      });
      continue;
    }
    if (line === '') continue;
    if ([...FOOTER_KEYS].some((key) => line.startsWith(key))) closeHit();
  }
  closeHit();
  return { source: 'indexed', groups, hits };
}

function lastGroupId(groups: readonly ZgQueryGroup[]): string | null {
  return groups.length > 0 ? (groups[groups.length - 1]?.id ?? null) : null;
}

function parseRgOutput(lines: readonly string[]): ParsedQuery {
  const hits: ZgHit[] = [];
  let path: string | null = null;
  let current: ZgHit | null = null;
  /** Block headers carry the authoritative range; raw source lines do not. */
  let fromBlock = false;

  const flush = (): void => {
    if (current) hits.push(current);
    current = null;
    fromBlock = false;
  };

  for (const line of lines) {
    const rgLine = line.match(SOURCE_LINE_RG);
    if (rgLine && path) {
      if (!current) {
        current = blankRgHit(hits.length + 1, path);
      }
      current.previewLines.push({ line: Number(rgLine[1]), text: rgLine[3] ?? '' });
      if (!fromBlock) {
        if (current.startLine === 0) current.startLine = Number(rgLine[1]);
        current.endLine = Number(rgLine[1]);
      }
      continue;
    }
    const block = line.match(RG_BLOCK);
    if (block && path) {
      flush();
      const headingInfo = parseRgHeading(block[3] ?? '');
      current = {
        ...blankRgHit(hits.length + 1, path),
        startLine: Number(block[1]) || 0,
        endLine: block[2] ? Number(block[2]) : null,
        heading: headingInfo.heading,
        headingLevel: headingInfo.level,
        scope: headingInfo.scope,
      };
      fromBlock = true;
      if (block[4] !== undefined && block[4] !== '') {
        // Single-line block: the source text is appended to the header.
        const inline = block[4].match(/^(\d+)[:-]\t(.*)$/);
        if (inline) {
          current.previewLines.push({ line: Number(inline[1]), text: inline[2] ?? '' });
          if (current.startLine === 0) current.startLine = Number(inline[1]);
        }
      }
      continue;
    }
    if (line === '' || line === '...' || line.startsWith('query groups')
      || line.startsWith('hits:') || line.startsWith('selection:')) {
      continue;
    }
    if (!line.startsWith(' ') && line.trim()) {
      flush();
      path = line.trim();
    }
  }
  flush();
  return { source: 'rg', groups: [], hits };
}

function blankRgHit(rank: number, path: string): ZgHit {
  return {
    rank,
    path,
    startLine: 0,
    endLine: null,
    rangeLabel: '',
    matchedBy: 'rg',
    group: null,
    heading: null,
    headingLevel: null,
    scope: null,
    stale: false,
    previewLines: [],
  };
}

function parseRgHeading(label: string): {
  heading: string | null;
  level: number | null;
  scope: string | null;
} {
  // Label shape: `heading \# A > \## B` (escaped markdown, ' > ' separators).
  if (!label.startsWith('heading ')) {
    return { heading: label || null, level: null, scope: null };
  }
  const parts = label
    .slice('heading '.length)
    .split(' > ')
    .map((part) => unescapeZgText(part).trim())
    .filter(Boolean);
  if (parts.length === 0) return { heading: null, level: null, scope: null };
  const last = parts[parts.length - 1] ?? '';
  const levelMatch = last.match(/^(#{1,6})\s+/);
  // Heading text keeps its leading hashes; the display layer strips them.
  return {
    heading: last,
    level: levelMatch ? (levelMatch[1]?.length ?? null) : null,
    scope: parts.length > 1 ? parts.join(' › ') : null,
  };
}

export function splitPathAndRange(value: string): {
  path: string;
  startLine: number;
  endLine: number | null;
  rangeLabel: string;
} {
  const match = value.match(/^(.*):(\d+)(?:-(\d+))?$/);
  if (match) {
    return {
      path: match[1] ?? value,
      startLine: Number(match[2]) || 0,
      endLine: match[3] ? Number(match[3]) : null,
      rangeLabel: `${match[2] ?? ''}${match[3] ? `-${match[3]}` : ''}`,
    };
  }
  const other = value.match(/^(.*):(bytes:\d+-\d+|page:\d+|file)$/);
  if (other) {
    return {
      path: other[1] ?? value,
      startLine: 0,
      endLine: null,
      rangeLabel: other[2] ?? '',
    };
  }
  return { path: value, startLine: 0, endLine: null, rangeLabel: '' };
}

// ---------------------------------------------------------------------------
// zg status

export type ZgWorkspaceState =
  | 'ready'
  | 'needs-update'
  | 'unconfigured'
  | 'unknown';

export interface ZgStatusInfo {
  state: ZgWorkspaceState;
  indexedFiles?: number;
  totalFiles?: number;
  coveragePercent?: number;
  entities?: number;
  model?: string;
  pending?: number;
  failed?: number;
  changes?: string;
}

export function parseStatusOutput(text: string): ZgStatusInfo {
  const info: ZgStatusInfo = { state: 'unknown' };
  if (/Workspace index is ready/.test(text)) info.state = 'ready';
  else if (/needs an update/.test(text)) info.state = 'needs-update';
  else if (/is not configured|not configured/.test(text)) {
    info.state = 'unconfigured';
  }

  const coverage = text.match(
    /(\d[\d,]*)\s*%\s+(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*files/,
  );
  if (coverage) {
    info.coveragePercent = Number(coverage[1]?.replaceAll(',', ''));
    info.indexedFiles = Number(coverage[2]?.replaceAll(',', ''));
    info.totalFiles = Number(coverage[3]?.replaceAll(',', ''));
  }
  const entities = text.match(/^\s+Entities\s+(\d[\d,]*)/m);
  if (entities) info.entities = Number(entities[1]?.replaceAll(',', ''));
  const model = text.match(/^\s+Embedding\s+(\S+)/m);
  if (model) info.model = model[1];
  const queue = text.match(/Queue\s+(\d+)\s+pending\s+·\s+(\d+)\s+failed/);
  if (queue) {
    info.pending = Number(queue[1]);
    info.failed = Number(queue[2]);
  }
  const changes = text.match(/^\s+Changes\s+(.+)$/m);
  if (changes) info.changes = changes[1]?.trim();
  return info;
}

// ---------------------------------------------------------------------------
// zg index progress lines

export interface IndexProgress {
  phase: 'downloading-model' | 'scanning' | 'indexing' | 'complete';
  message: string;
  percent?: number;
}

export function parseIndexProgressLine(line: string): IndexProgress | null {
  const value = line.trim();
  if (!value) return null;
  if (value.startsWith('tip\t') || value.startsWith('tip\t'.replace('\t', ' '))) {
    return null;
  }
  const download = value.match(
    /^Downloading (\S+).*?(\d+)%\s*(.*)$/,
  );
  if (download) {
    return {
      phase: 'downloading-model',
      message: `Downloading ${download[1]} · ${download[2]}%${
        download[3] ? ` · ${download[3].trim()}` : ''
      }`,
      percent: Number(download[2]),
    };
  }
  if (value === 'Scanning files...' || value === 'Scanning files') {
    return { phase: 'scanning', message: 'Scanning files…' };
  }
  if (value === 'Indexing complete') {
    return { phase: 'complete', message: 'Indexing complete' };
  }
  if (value === 'Preparing' || value.startsWith('Preparing ')) {
    return { phase: 'indexing', message: value };
  }
  return null;
}

export interface IndexSummary {
  files?: string;
  entities?: string;
  duration?: string;
}

export function parseIndexSummary(text: string): IndexSummary {
  const summary: IndexSummary = {};
  const files = text.match(/^files\t(.+)$/m);
  if (files) summary.files = files[1]?.trim();
  const entities = text.match(/^entities\t(.+)$/m);
  if (entities) summary.entities = entities[1]?.trim();
  const duration = text.match(/^duration\t(.+)$/m);
  if (duration) summary.duration = duration[1]?.trim();
  return summary;
}
