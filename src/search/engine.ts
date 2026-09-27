import {
  type ResultGrouping,
  type SearchRequest,
  type SearchResponse,
  type SearchResult,
  type SortOrder,
  type VaultFileStat,
} from '../types';
import { basenameWithoutExtension, normalizeVaultPath, queryTerms } from './text';
import { buildQueryArgs } from '../zg/args';
import {
  parseQueryOutput,
  type ZgHit,
} from '../zg/parse';
import { assertOk, type ZgRunner } from '../zg/runner';

const PREVIEW_MAX_CHARS = 1200;
const PREVIEW_MAX_LINE_CHARS = 300;
const PREVIEW_LINES = 4;

export class ZgSearchEngine {
  constructor(
    private readonly runner: ZgRunner,
    private readonly vaultRoot: string,
    private readonly getSettings: () => {
      includeGlobs: readonly string[];
      excludeGlobs: readonly string[];
    },
    private readonly getFileStat:
      | ((path: string) => VaultFileStat | undefined)
      | null = null,
  ) {}

  async search(request: SearchRequest): Promise<SearchResponse> {
    const startedAt = Date.now();
    const settings = this.getSettings();
    const args = buildQueryArgs(request, {
      includeGlobs: [...settings.includeGlobs],
      excludeGlobs: [...settings.excludeGlobs],
    });
    const outcome = await this.runner.run(args, {
      cwd: this.vaultRoot,
      timeoutMs: 90_000,
      taskKey: 'query',
    });
    if (outcome.cancelled) {
      throw Object.assign(new Error('Search cancelled.'), { cancelled: true });
    }
    assertOk(outcome, 'Search');
    const parsed = parseQueryOutput(outcome.stdout);
    const terms = queryTerms(request.query);
    const results = this.toResults(parsed.hits, request, terms);
    return {
      results,
      total: results.length,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private toResults(
    hits: readonly ZgHit[],
    request: SearchRequest,
    terms: readonly string[],
  ): SearchResult[] {
    let mapped = hits.map((hit): SearchResult => {
      const path = normalizeVaultPath(hit.path);
      const stat = this.getFileStat?.(path);
      const anchor = anchorPreview(hit, terms);
      return {
        path,
        title: stat?.title ?? basenameWithoutExtension(path),
        heading: displayHeading(hit),
        preview: anchor.preview,
        // Point result activation at the matched line, not the section start.
        startLine: anchor.line ?? hit.startLine,
        endLine: hit.endLine,
        matchedBy: hit.matchedBy,
        rank: hit.rank,
        stale: hit.stale,
        mtime: stat?.mtime ?? 0,
        ctime: stat?.ctime ?? 0,
      };
    });
    if (request.grouping === 'notes') {
      const byPath = new Map<string, SearchResult>();
      for (const result of mapped) {
        if (!byPath.has(result.path)) byPath.set(result.path, result);
      }
      mapped = [...byPath.values()];
    }
    return sortResults(mapped, request.sort);
  }
}

function displayHeading(hit: ZgHit): string {
  if (hit.scope) return hit.scope.split('::').map((part) => part.trim()).join(' › ');
  if (hit.heading) {
    return hit.heading.replace(/^#{1,6}\s+/, '');
  }
  return '';
}

/**
 * Picks the preview window and activation line: the first section line that
 * contains any query term anchors both. zg reports whole sections as the hit
 * range, so without this anchor the preview and the jump target would sit at
 * the section start even when the match is deep inside. Falls back to the
 * window head (semantic hits with no lexical overlap).
 */
export function anchorPreview(
  hit: ZgHit,
  terms: readonly string[],
): { preview: string; line: number | null } {
  const numbered = hit.previewLines.filter((entry) => entry.line !== null);
  const needles = terms
    .filter((term) => term.length >= 2)
    .map((term) => term.toLowerCase());
  let anchorIndex = 0;
  if (needles.length > 0) {
    // Anchor at the line matching the most distinct query terms; ties keep
    // the earliest, so multi-word queries land on the densest match.
    let bestScore = 0;
    for (let index = 0; index < numbered.length; index += 1) {
      const text = numbered[index]?.text?.toLowerCase() ?? '';
      let score = 0;
      for (const needle of needles) {
        if (text.includes(needle)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        anchorIndex = index;
      }
    }
  }
  const window = numbered.slice(anchorIndex, anchorIndex + PREVIEW_LINES);
  if (window.length === 0) return { preview: '', line: null };
  const lines = window.map((entry) => {
    let text = entry.text?.replace(/^#{1,6}[ \t]+/, '') ?? '';
    if (text.startsWith('\\')) text = text.slice(1);
    text = text.trimEnd();
    return text.length > PREVIEW_MAX_LINE_CHARS
      ? `${text.slice(0, PREVIEW_MAX_LINE_CHARS - 1)}…`
      : text;
  });
  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
  let preview = lines.join('\n').trim();
  if (preview.length > PREVIEW_MAX_CHARS) {
    preview = `${preview.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
  }
  return { preview, line: window[0]?.line ?? null };
}

export function sortResults(
  results: readonly SearchResult[],
  sort: SortOrder,
): SearchResult[] {
  const copy = [...results];
  const compare = comparers[sort] ?? comparers.relevance;
  copy.sort(compare);
  return copy;
}

const comparers: Record<SortOrder, (a: SearchResult, b: SearchResult) => number> = {
  relevance: (a, b) => a.rank - b.rank,
  'modified-desc': (a, b) => b.mtime - a.mtime || a.rank - b.rank,
  'modified-asc': (a, b) => a.mtime - b.mtime || a.rank - b.rank,
  'created-desc': (a, b) => b.ctime - a.ctime || a.rank - b.rank,
  'created-asc': (a, b) => a.ctime - b.ctime || a.rank - b.rank,
  'title-asc': (a, b) => a.title.localeCompare(b.title) || a.rank - b.rank,
  'title-desc': (a, b) => b.title.localeCompare(a.title) || a.rank - b.rank,
};
