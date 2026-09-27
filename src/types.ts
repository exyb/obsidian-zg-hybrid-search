export const PLUGIN_DIR_NAME = 'zg-hybrid-search';
export const ZG_INDEX_DIR = '.zvec-grep';

export type SearchMode = 'hybrid' | 'keyword' | 'semantic';
export type MatchMode = 'terms' | 'phrase';
export type SortOrder =
  | 'relevance'
  | 'modified-desc'
  | 'modified-asc'
  | 'created-desc'
  | 'created-asc'
  | 'title-asc'
  | 'title-desc';
export type ResultGrouping = 'notes' | 'passages';
export type EmbeddingDevice = 'auto' | 'cpu' | 'metal' | 'vulkan' | 'cuda';

export interface HybridSearchSettings {
  /** Explicit path to the zg CLI. Empty means auto-detect. */
  zgPath: string;
  embeddingModel: string;
  device: EmbeddingDevice;
  /** Local model cache directory. Empty uses the zg default. */
  modelCachePath: string;
  /** Include globs passed to `zg index`/`zg query --rg` (no leading '!'). */
  includeGlobs: string[];
  /** Vault-relative exclude globs passed with a '!' prefix. */
  excludeGlobs: string[];
  autoIndex: boolean;
  defaultMode: SearchMode;
  defaultMatchMode: MatchMode;
  defaultSort: SortOrder;
  defaultGrouping: ResultGrouping;
  /** Results revealed per batch in the sidebar. */
  resultLimit: number;
  /** Maximum hits requested from zg per query. */
  queryLimit: number;
  /** Quiet period after vault edits before an incremental index runs. */
  quietPeriodMs: number;
}

export const DEFAULT_SETTINGS: HybridSearchSettings = {
  zgPath: '',
  embeddingModel: 'local/potion-multilingual-128m',
  device: 'auto',
  modelCachePath: '',
  includeGlobs: ['*.md'],
  excludeGlobs: ['.trash/**'],
  autoIndex: true,
  defaultMode: 'hybrid',
  defaultMatchMode: 'terms',
  defaultSort: 'relevance',
  defaultGrouping: 'notes',
  resultLimit: 20,
  queryLimit: 50,
  quietPeriodMs: 10_000,
};

export interface VaultFileStat {
  mtime: number;
  ctime: number;
  title: string;
}

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  matchMode: MatchMode;
  sort: SortOrder;
  grouping: ResultGrouping;
  limit: number;
  modifiedFrom?: number;
  modifiedTo?: number;
}

export type MatchedBy = 'fts' | 'vector' | 'fts+vector' | 'rg' | string;

export interface SearchResult {
  path: string;
  title: string;
  heading: string;
  preview: string;
  startLine: number;
  endLine: number | null;
  matchedBy: MatchedBy;
  rank: number;
  stale: boolean;
  mtime: number;
  ctime: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  elapsedMs: number;
}

export type IndexPhase =
  | 'idle'
  | 'resolving'
  | 'unconfigured'
  | 'downloading-model'
  | 'scanning'
  | 'indexing'
  | 'ready'
  | 'stale'
  | 'cancelled'
  | 'error';

export interface IndexStats {
  totalFiles?: number;
  indexedFiles?: number;
  coveragePercent?: number;
  entities?: number;
  model?: string;
  changes?: string;
}

export interface IndexStatus {
  phase: IndexPhase;
  message: string;
  background?: boolean;
  /** Numeric progress when known (model downloads). */
  progress?: { completed: number; total: number } | null;
  stats?: IndexStats | null;
  error?: string;
}

export const INITIAL_INDEX_STATUS: IndexStatus = {
  phase: 'idle',
  message: 'Locating zg…',
};
