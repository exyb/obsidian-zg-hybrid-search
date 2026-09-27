import {
  FileSystemAdapter,
  Notice,
  Plugin,
  TFile,
  type TAbstractFile,
  type WorkspaceLeaf,
} from 'obsidian';
import { IndexManager } from './src/indexing/index-manager';
import type { ZgPluginApi } from './src/plugin-api';
import { ZgSearchEngine } from './src/search/engine';
import { basenameWithoutExtension } from './src/search/text';
import { normalizeSettings } from './src/settings';
import {
  DEFAULT_SETTINGS,
  INITIAL_INDEX_STATUS,
  type HybridSearchSettings,
  type IndexStatus,
  type VaultFileStat,
} from './src/types';
import { errorMessage, withTimeout } from './src/util/async';
import { resolveToolchain, type Toolchain } from './src/zg/locate';
import { assertOk, ZgRunner } from './src/zg/runner';
import {
  ZgSearchView,
  VIEW_TYPE_ZG_SEARCH,
} from './src/ui/search-view';
import { ZgSearchSettingTab } from './src/ui/settings-tab';

export default class ZgHybridSearchPlugin
  extends Plugin
  implements ZgPluginApi {
  override settings: HybridSearchSettings = { ...DEFAULT_SETTINGS };
  indexStatus: IndexStatus = { ...INITIAL_INDEX_STATUS };
  engine: ZgSearchEngine | null = null;

  private runner: ZgRunner | null = null;
  private indexManager: IndexManager | null = null;
  private toolchainPromise: Promise<void> | null = null;
  private vaultRoot: string | null = null;
  private isUnloading = false;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_ZG_SEARCH,
      (leaf) => new ZgSearchView(leaf, this),
    );
    this.addRibbonIcon('scan-search', 'Open hybrid search', () => {
      void this.runSafely('Opening the search sidebar', () => this.activateView());
    });
    this.addCommand({
      id: 'open',
      name: 'Open hybrid search',
      callback: () => void this.runSafely(
        'Opening the search sidebar',
        () => this.activateView(),
      ),
    });
    this.addCommand({
      id: 'focus-search-input',
      name: 'Focus hybrid search input',
      callback: () => void this.runSafely(
        'Focusing the search sidebar',
        () => this.activateView(true),
      ),
    });
    this.addCommand({
      id: 'reindex-incremental',
      name: 'Incrementally reindex notes',
      callback: () => void this.runSafely(
        'Incremental reindex',
        () => this.runIncrementalIndex(false),
      ),
    });
    this.addCommand({
      id: 'rebuild-index',
      name: 'Reset and rebuild search index',
      callback: () => void this.runSafely(
        'Reset and rebuild',
        () => this.rebuildIndex(),
      ),
    });
    this.addSettingTab(new ZgSearchSettingTab(this));

    this.app.workspace.onLayoutReady(() => {
      void this.runSafely('Starting ZG Hybrid Search', async () => {
        await this.ensureRuntimeReady();
        await this.indexManager?.start();
      }, false);
      const scheduleFile = (file: TAbstractFile): void => {
        this.indexManager?.onVaultEvent(
          file instanceof TFile ? file.path : null,
        );
      };
      this.registerEvent(this.app.vault.on('create', scheduleFile));
      this.registerEvent(this.app.vault.on('modify', scheduleFile));
      this.registerEvent(this.app.vault.on('delete', scheduleFile));
      this.registerEvent(this.app.vault.on('rename', (file) => {
        this.indexManager?.onVaultEvent(
          file instanceof TFile ? file.path : null,
        );
      }));
    });
  }

  override onunload(): void {
    this.isUnloading = true;
    this.indexManager?.stop();
    this.runner?.cancelAll();
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await withTimeout(
      this.saveData(this.settings),
      5000,
      'Saving ZG settings',
    ).catch((error) => {
      this.reportError('Settings could not be saved', error, true);
    });
  }

  async ensureRuntimeReady(): Promise<void> {
    if (this.engine && this.indexManager) return;
    if (this.isUnloading) throw new Error('ZG Hybrid Search is stopping.');
    if (this.toolchainPromise) return this.toolchainPromise;
    const creating = this.createRuntime();
    this.toolchainPromise = creating.finally(() => {
      this.toolchainPromise = null;
    });
    return this.toolchainPromise;
  }

  cancelIndexing(): void {
    this.indexManager?.cancel();
  }

  async runIncrementalIndex(background: boolean): Promise<void> {
    await this.ensureRuntimeReady();
    await this.indexManager?.runIncremental(background);
  }

  async buildIndex(): Promise<void> {
    await this.runIncrementalIndex(false);
  }

  async rebuildIndex(): Promise<void> {
    await this.ensureRuntimeReady();
    await this.indexManager?.rebuild();
  }

  async runSafely(
    context: string,
    action: () => Promise<void>,
    showNotice = true,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.reportError(`${context} failed`, error, showNotice);
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings = normalizeSettings(await withTimeout(
        this.loadData() as Promise<unknown>,
        5000,
        'Loading ZG settings',
      ));
    } catch (error) {
      this.settings = normalizeSettings(null);
      console.warn(
        'ZG Hybrid Search could not load settings; using safe defaults',
        error,
      );
    }
  }

  private async createRuntime(): Promise<void> {
    this.updateStatus({
      phase: 'resolving',
      message: 'Locating zg…',
    });
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error('ZG Hybrid Search requires a local desktop vault.');
    }
    this.vaultRoot = adapter.getBasePath();
    const toolchain = await resolveToolchain(this.settings.zgPath);
    const runner = new ZgRunner(() => Promise.resolve(toolchain));
    const indexManager = new IndexManager({
      runner,
      vaultRoot: this.vaultRoot,
      getSettings: () => this.settings,
      publish: (status) => this.updateStatus(status),
    });
    const engine = new ZgSearchEngine(
      runner,
      this.vaultRoot,
      () => this.settings,
      (path) => this.vaultStat(path),
    );
    // Smoke-check the toolchain before publishing components.
    const probe = await runner.run(['status', '--mode', 'direct'], {
      cwd: this.vaultRoot,
      timeoutMs: 30_000,
      taskKey: 'status',
    });
    if (probe.timedOut) throw new Error('zg did not respond in time.');
    if (probe.code !== 0) assertOk(probe, 'Checking zg');
    this.runner = runner;
    this.indexManager = indexManager;
    this.engine = engine;
    this.updateStatus({
      phase: 'idle',
      message: `zg ${toolchain.version} ready.`,
    });
  }

  private vaultStat(path: string): VaultFileStat | undefined {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return undefined;
    return {
      mtime: file.stat.mtime,
      ctime: file.stat.ctime,
      title: basenameWithoutExtension(file.name),
    };
  }

  private updateStatus(update: Partial<IndexStatus>): void {
    if (this.isUnloading) return;
    const nextError = Object.hasOwn(update, 'error')
      ? update.error
      : update.phase && update.phase !== 'error'
        ? undefined
        : this.indexStatus.error;
    this.indexStatus = {
      ...this.indexStatus,
      ...update,
      error: nextError,
    };
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ZG_SEARCH)) {
      if (leaf.view instanceof ZgSearchView) {
        leaf.view.updateIndexStatus(this.indexStatus);
      }
    }
  }

  private async activateView(focus = true): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_ZG_SEARCH);
    let leaf: WorkspaceLeaf | null = existing[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice('Could not open the ZG search sidebar.');
        return;
      }
      await leaf.setViewState({
        type: VIEW_TYPE_ZG_SEARCH,
        active: true,
      });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (focus && leaf.view instanceof ZgSearchView) {
      leaf.view.focusSearch();
    }
  }

  private reportError(
    context: string,
    error: unknown,
    showNotice: boolean,
  ): void {
    const message = errorMessage(error);
    console.error(`ZG Hybrid Search: ${context}`, error);
    this.updateStatus({
      phase: 'error',
      message: context,
      error: message,
    });
    if (showNotice && !this.isUnloading) {
      new Notice(`ZG Hybrid Search: ${context}. ${message}`, 8000);
    }
  }
}
