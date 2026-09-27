import {
  DEFAULT_SETTINGS,
  type EmbeddingDevice,
  type HybridSearchSettings,
  type MatchMode,
  type ResultGrouping,
  type SearchMode,
  type SortOrder,
} from './types';

const SEARCH_MODES = new Set(['hybrid', 'keyword', 'semantic']);
const MATCH_MODES = new Set(['terms', 'phrase']);
const SORT_ORDERS = new Set([
  'relevance',
  'modified-desc',
  'modified-asc',
  'created-desc',
  'created-asc',
  'title-asc',
  'title-desc',
]);
const GROUPINGS = new Set(['notes', 'passages']);
const DEVICES = new Set(['auto', 'cpu', 'metal', 'vulkan', 'cuda']);

/** One glob per line; '!' prefixes are stripped so they can be re-added per command. */
export function parseGlobList(value: string): string[] {
  return [...new Set(value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^!+/, '').replaceAll('\\', '/'))
    .filter((line) => line.length > 0 && !line.startsWith('#')))];
}

export function formatGlobList(globs: readonly string[]): string {
  return globs.join('\n');
}

export function normalizeSettings(raw: unknown): HybridSearchSettings {
  const saved = isRecord(raw) ? raw : {};
  return {
    zgPath: boundedString(saved.zgPath, DEFAULT_SETTINGS.zgPath, 1000),
    embeddingModel: boundedString(
      saved.embeddingModel,
      DEFAULT_SETTINGS.embeddingModel,
      200,
    ),
    device: enumValue<EmbeddingDevice>(
      saved.device,
      DEVICES,
      DEFAULT_SETTINGS.device,
    ),
    modelCachePath: boundedString(
      saved.modelCachePath,
      DEFAULT_SETTINGS.modelCachePath,
      1000,
    ),
    includeGlobs: stringList(
      saved.includeGlobs,
      DEFAULT_SETTINGS.includeGlobs,
      100,
    ),
    excludeGlobs: stringList(
      saved.excludeGlobs,
      DEFAULT_SETTINGS.excludeGlobs,
      100,
    ),
    autoIndex: booleanValue(saved.autoIndex, DEFAULT_SETTINGS.autoIndex),
    defaultMode: enumValue<SearchMode>(
      saved.defaultMode,
      SEARCH_MODES,
      DEFAULT_SETTINGS.defaultMode,
    ),
    defaultMatchMode: enumValue<MatchMode>(
      saved.defaultMatchMode,
      MATCH_MODES,
      DEFAULT_SETTINGS.defaultMatchMode,
    ),
    defaultSort: enumValue<SortOrder>(
      saved.defaultSort,
      SORT_ORDERS,
      DEFAULT_SETTINGS.defaultSort,
    ),
    defaultGrouping: enumValue<ResultGrouping>(
      saved.defaultGrouping,
      GROUPINGS,
      DEFAULT_SETTINGS.defaultGrouping,
    ),
    resultLimit: integerValue(
      saved.resultLimit,
      1,
      100,
      DEFAULT_SETTINGS.resultLimit,
    ),
    queryLimit: integerValue(
      saved.queryLimit,
      1,
      200,
      DEFAULT_SETTINGS.queryLimit,
    ),
    quietPeriodMs: integerValue(
      saved.quietPeriodMs,
      1_000,
      300_000,
      DEFAULT_SETTINGS.quietPeriodMs,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

function stringList(
  value: unknown,
  fallback: string[],
  maxItems: number,
): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const result = [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems))];
  return result.length > 0 ? result : [...fallback];
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integerValue(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Math.round(numberValue(value, minimum, maximum, fallback));
}

function numberValue(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function enumValue<T extends string>(
  value: unknown,
  allowed: Set<string>,
  fallback: T,
): T {
  return typeof value === 'string' && allowed.has(value)
    ? value as T
    : fallback;
}
