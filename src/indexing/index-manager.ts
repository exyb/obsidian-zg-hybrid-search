import { errorMessage, Debouncer, OperationCancelledError } from '../util/async';
import type { HybridSearchSettings, IndexStatus } from '../types';
import {
  buildDropIndexArgs,
  buildIncrementalIndexArgs,
} from '../zg/args';
import {
  parseIndexProgressLine,
  parseIndexSummary,
  parseStatusOutput,
  type ZgStatusInfo,
} from '../zg/parse';
import { zgErrorMessage, type ZgRunner } from '../zg/runner';

export interface IndexManagerOptions {
  runner: ZgRunner;
  vaultRoot: string;
  getSettings: () => HybridSearchSettings;
  publish: (status: IndexStatus) => void;
}

/**
 * Owns the workspace's zg index lifecycle: status probing, incremental runs
 * after vault edits, full builds, and rebuilds. All zg child processes are
 * keyed 'index' so at most one index command runs at a time.
 */
export class IndexManager {
  private readonly debouncer = new Debouncer();
  private indexRun: Promise<void> | null = null;
  private rerunRequested = false;
  private lastStatus: ZgStatusInfo | null = null;
  private unloaded = false;

  constructor(private readonly options: IndexManagerOptions) {}

  async start(): Promise<void> {
    if (this.unloaded) return;
    let status: ZgStatusInfo;
    try {
      status = await this.refreshStatus();
    } catch (error) {
      this.options.publish({
        phase: 'error',
        message: 'Could not read the zg index status.',
        error: errorMessage(error),
      });
      return;
    }
    if (this.unloaded) return;
    if (status.state === 'unconfigured' && this.options.getSettings().autoIndex) {
      await this.runIncremental(false);
    } else if (status.state === 'needs-update'
      && this.options.getSettings().autoIndex) {
      await this.runIncremental(true);
    }
  }

  async refreshStatus(): Promise<ZgStatusInfo> {
    const outcome = await this.options.runner.run(['status', '--mode', 'direct'], {
      cwd: this.options.vaultRoot,
      timeoutMs: 30_000,
      taskKey: 'status',
    });
    if (outcome.cancelled || outcome.timedOut) {
      throw new OperationCancelledError('Status check');
    }
    const error = zgErrorMessage(outcome);
    if (error && !outcome.stdout.includes('Workspace index')) {
      throw new Error(error);
    }
    const status = parseStatusOutput(outcome.stdout);
    this.lastStatus = status;
    this.publishStatusFromZg(status);
    return status;
  }

  private publishStatusFromZg(status: ZgStatusInfo): void {
    const stats = {
      indexedFiles: status.indexedFiles,
      totalFiles: status.totalFiles,
      coveragePercent: status.coveragePercent,
      entities: status.entities,
      model: status.model,
      changes: status.changes,
    };
    if (status.state === 'ready') {
      this.options.publish({
        phase: 'ready',
        message: 'Index ready.',
        stats,
      });
    } else if (status.state === 'needs-update') {
      this.options.publish({
        phase: 'stale',
        message: 'Index needs an update.',
        stats,
      });
    } else if (status.state === 'unconfigured') {
      this.options.publish({
        phase: 'unconfigured',
        message: 'Index not built yet.',
        stats: null,
      });
    } else {
      this.options.publish({
        phase: 'idle',
        message: 'Index status unknown.',
        stats,
      });
    }
  }

  /** Debounced incremental run after a vault event; hidden paths are ignored. */
  onVaultEvent(path: string | null): void {
    if (this.unloaded || !this.options.getSettings().autoIndex) return;
    if (path && (path.startsWith('.') || path.includes('/.'))) return;
    this.debouncer.schedule(() => {
      void this.runIncremental(true).catch(() => undefined);
    }, this.options.getSettings().quietPeriodMs);
  }

  async runIncremental(background: boolean): Promise<void> {
    if (this.indexRun) {
      this.rerunRequested = true;
      return this.indexRun;
    }
    this.indexRun = this.executeIndex(background, false)
      .finally(() => {
        this.indexRun = null;
        if (this.rerunRequested && !this.unloaded) {
          this.rerunRequested = false;
          void this.runIncremental(true).catch(() => undefined);
        }
      });
    return this.indexRun;
  }

  async rebuild(): Promise<void> {
    if (this.indexRun) {
      this.rerunRequested = true;
      return this.indexRun;
    }
    this.indexRun = this.executeIndex(false, true)
      .finally(() => {
        this.indexRun = null;
      });
    return this.indexRun;
  }

  private async executeIndex(
    background: boolean,
    dropFirst: boolean,
  ): Promise<void> {
    const { runner, vaultRoot, getSettings, publish } = this.options;
    publish({
      phase: 'indexing',
      message: dropFirst ? 'Rebuilding the index…' : 'Updating the index…',
      background,
    });
    if (dropFirst) {
      publish({
        phase: 'indexing',
        message: 'Dropping the existing index…',
        background,
      });
      const drop = await runner.run(buildDropIndexArgs(), {
        cwd: vaultRoot,
        timeoutMs: 60_000,
        taskKey: 'index',
      });
      if (drop.cancelled) {
        publish({ phase: 'cancelled', message: 'Indexing cancelled.' });
        return;
      }
    }

    let lastMessage = '';
    const outcome = await runner.run(buildIncrementalIndexArgs(getSettings()), {
      cwd: vaultRoot,
      timeoutMs: 0,
      taskKey: 'index',
      onLine: (line) => {
        const progress = parseIndexProgressLine(line);
        if (!progress) return;
        lastMessage = progress.message;
        publish({
          phase: progress.phase === 'complete' ? 'indexing' : progress.phase,
          message: progress.message,
          background,
          progress: progress.percent !== undefined
            ? { completed: progress.percent, total: 100 }
            : null,
        });
      },
    });
    if (this.unloaded) return;
    if (outcome.cancelled) {
      publish({ phase: 'cancelled', message: 'Indexing cancelled.' });
      return;
    }
    if (outcome.timedOut) {
      publish({
        phase: 'error',
        message: 'Indexing timed out.',
      });
      return;
    }
    const error = zgErrorMessage(outcome);
    if (error) {
      publish({
        phase: 'error',
        message: 'Indexing failed.',
        error,
      });
      return;
    }
    const summary = parseIndexSummary(outcome.stdout);
    const summaryText = [
      summary.files ? `files: ${summary.files}` : null,
      summary.entities ? `entities: ${summary.entities}` : null,
      summary.duration ? `duration: ${summary.duration}` : null,
    ].filter(Boolean).join(' · ');
    try {
      await this.refreshStatus();
    } catch {
      this.options.publish({
        phase: 'ready',
        message: summaryText || lastMessage || 'Indexing complete.',
      });
    }
  }

  cancel(): void {
    this.debouncer.cancel();
    this.rerunRequested = false;
    this.options.runner.cancelTask('index');
  }

  get currentState(): ZgStatusInfo | null {
    return this.lastStatus;
  }

  stop(): void {
    this.unloaded = true;
    this.cancel();
  }
}
