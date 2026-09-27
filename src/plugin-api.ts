import type { ZgSearchEngine } from './search/engine';
import type { HybridSearchSettings, IndexStatus } from './types';

/**
 * The slice of the plugin the sidebar view depends on. Kept as an interface so
 * the view can be exercised without instantiating the full plugin.
 */
export interface ZgPluginApi {
  readonly settings: HybridSearchSettings;
  indexStatus: IndexStatus;
  readonly engine: ZgSearchEngine | null;
  ensureRuntimeReady(): Promise<void>;
  cancelIndexing(): void;
  runIncrementalIndex(background: boolean): Promise<void>;
  buildIndex(): Promise<void>;
  rebuildIndex(): Promise<void>;
}
