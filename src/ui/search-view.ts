import {
  ItemView,
  MarkdownView,
  Notice,
  TFile,
  type WorkspaceLeaf,
} from 'obsidian';
import type { ZgPluginApi } from '../plugin-api';
import type {
  IndexStatus,
  MatchMode,
  ResultGrouping,
  SearchMode,
  SearchResponse,
  SearchResult,
  SortOrder,
} from '../types';
import { modifiedDateRangeFromInputs } from './date-range';
import { queryTerms } from '../search/text';
import { resultActivationFor } from './result-activation';
import { ResultPager } from './result-pager';
import { SearchSession } from './search-session';

export const VIEW_TYPE_ZG_SEARCH = 'zg-hybrid-search-view';

export class ZgSearchView extends ItemView {
  private queryInput: HTMLInputElement | null = null;
  private mode: SearchMode;
  private matchMode: MatchMode;
  private sort: SortOrder;
  private grouping: ResultGrouping;
  private modifiedFromInput: HTMLInputElement | null = null;
  private modifiedToInput: HTMLInputElement | null = null;
  private statusEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private progressEl: HTMLProgressElement | null = null;
  private cancelButtonEl: HTMLButtonElement | null = null;
  private buildButtonEl: HTMLButtonElement | null = null;
  private copyErrorButtonEl: HTMLButtonElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private searchButtonEl: HTMLButtonElement | null = null;
  private clearButtonEl: HTMLButtonElement | null = null;
  private loadMoreButtonEl: HTMLButtonElement | null = null;
  private activeResponse: SearchResponse | null = null;
  private lastErrorText: string | null = null;
  /** Phase observed on the previous status push, for completion transitions. */
  private lastSeenPhase: IndexStatus['phase'] | null = null;
  private readonly searchSession = new SearchSession();
  private readonly resultPager = new ResultPager<SearchResult>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ZgPluginApi,
  ) {
    super(leaf);
    this.mode = plugin.settings.defaultMode;
    this.matchMode = plugin.settings.defaultMatchMode;
    this.sort = plugin.settings.defaultSort;
    this.grouping = plugin.settings.defaultGrouping;
  }

  getViewType(): string {
    return VIEW_TYPE_ZG_SEARCH;
  }

  getDisplayText(): string {
    return 'ZG Search';
  }

  override getIcon(): string {
    return 'scan-search';
  }

  override async onOpen(): Promise<void> {
    this.renderShell();
    this.updateIndexStatus(this.plugin.indexStatus);
    window.setTimeout(() => this.queryInput?.focus(), 0);
  }

  override async onClose(): Promise<void> {
    this.searchSession.clear();
    this.queryInput = null;
    this.searchButtonEl = null;
    this.clearButtonEl = null;
    this.loadMoreButtonEl = null;
    this.activeResponse = null;
    this.lastErrorText = null;
    this.resultPager.clear();
    this.statusEl = null;
    this.statsEl = null;
    this.errorEl = null;
    this.progressEl = null;
    this.cancelButtonEl = null;
    this.buildButtonEl = null;
    this.copyErrorButtonEl = null;
    this.resultsEl = null;
    this.summaryEl = null;
    this.modifiedFromInput = null;
    this.modifiedToInput = null;
  }

  updateIndexStatus(status: IndexStatus): void {
    if (!this.statusEl || !this.progressEl) return;
    const previousPhase = this.lastSeenPhase;
    this.lastSeenPhase = status.phase;
    const wasActive = previousPhase === 'downloading-model'
      || previousPhase === 'indexing'
      || previousPhase === 'scanning';
    const isActive = [
      'downloading-model',
      'indexing',
      'scanning',
    ].includes(status.phase);
    // An index run just finished: refresh the displayed search so results
    // reflect the freshly indexed content.
    if (wasActive
      && (status.phase === 'ready' || status.phase === 'stale')
      && this.searchSession.hasActiveSearch) {
      window.setTimeout(() => {
        if (this.searchSession.hasActiveSearch) void this.runSearch();
      }, 0);
    }
    if (status.error) {
      this.lastErrorText = `${status.message}\n${status.error}`;
    } else if (
      status.phase === 'ready'
      || status.phase === 'stale'
      || status.phase === 'unconfigured'
      || status.phase === 'idle'
    ) {
      this.lastErrorText = null;
    }
    if (this.statusEl.textContent !== status.message) {
      this.statusEl.setText(status.message);
    }
    this.statusEl.toggleClass('is-error', status.phase === 'error');
    if (this.errorEl) {
      this.errorEl.setText(this.lastErrorText ?? '');
      this.errorEl.toggleAttribute('hidden', !this.lastErrorText);
    }
    this.copyErrorButtonEl?.toggleAttribute('hidden', !this.lastErrorText);
    this.progressEl.toggleAttribute('hidden', !isActive);
    if (isActive && status.progress && status.progress.total > 0) {
      this.progressEl.max = status.progress.total;
      this.progressEl.value = Math.min(
        status.progress.completed,
        status.progress.total,
      );
    } else {
      this.progressEl.removeAttribute('value');
    }
    this.cancelButtonEl?.toggleAttribute('hidden', !isActive);
    const showBuild = status.phase === 'unconfigured';
    this.buildButtonEl?.toggleAttribute('hidden', !showBuild);
    if (this.statsEl) {
      const stats = status.stats;
      const parts: string[] = [];
      if (stats?.model) parts.push(stats.model);
      if (stats?.totalFiles !== undefined) {
        parts.push(`${stats.indexedFiles ?? 0}/${stats.totalFiles} files`);
      }
      if (stats?.entities !== undefined) parts.push(`${stats.entities} sections`);
      this.statsEl.setText(parts.join(' · '));
      this.statsEl.toggleAttribute('hidden', parts.length === 0);
    }
  }

  focusSearch(): void {
    this.queryInput?.focus();
    this.queryInput?.select();
  }

  private renderShell(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('zg-search-view');

    const searchRow = container.createDiv({ cls: 'zg-search-row' });
    this.queryInput = searchRow.createEl('input', {
      type: 'search',
      placeholder: 'Search notes by words or meaning…',
      attr: {
        'aria-label': 'Search indexed notes',
        autocomplete: 'off',
        spellcheck: 'false',
      },
    });
    this.searchButtonEl = searchRow.createEl('button', {
      text: 'Search',
      cls: 'mod-cta',
      attr: { 'aria-label': 'Run search' },
    });
    this.searchButtonEl.addEventListener('click', () => void this.runSearch());
    this.clearButtonEl = searchRow.createEl('button', {
      text: 'Clear',
      attr: { 'aria-label': 'Clear search and results' },
    });
    this.clearButtonEl.disabled = true;
    this.clearButtonEl.addEventListener('click', () => this.clearSearch());
    this.queryInput.addEventListener('input', () => {
      if (
        this.searchSession.invalidateIfInputChanged(
          this.queryInput?.value ?? '',
        )
      ) {
        this.clearRenderedSearch();
      }
      this.syncClearButton();
    });
    this.queryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.runSearch();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.clearSearch();
      }
    });

    const options = container.createEl('details', {
      cls: 'zg-search-options',
    });
    options.createEl('summary', { text: 'Search options' });
    const controls = options.createDiv({ cls: 'zg-search-controls' });
    this.mode = this.createSelect<SearchMode>(
      controls,
      'Search mode',
      {
        hybrid: 'Hybrid',
        keyword: 'Keywords',
        semantic: 'Semantic',
      },
      this.mode,
      (value) => { this.mode = value; },
    );
    this.matchMode = this.createSelect<MatchMode>(
      controls,
      'Match',
      {
        terms: 'Terms (ranked)',
        phrase: 'Exact phrase',
      },
      this.matchMode,
      (value) => { this.matchMode = value; },
    );
    this.sort = this.createSelect<SortOrder>(
      controls,
      'Sort order',
      {
        relevance: 'Relevance',
        'modified-desc': 'Modified: newest',
        'modified-asc': 'Modified: oldest',
        'created-desc': 'Created: newest',
        'created-asc': 'Created: oldest',
        'title-asc': 'Title: A–Z',
        'title-desc': 'Title: Z–A',
      },
      this.sort,
      (value) => {
        this.sort = value;
        if (this.queryInput?.value.trim()) void this.runSearch();
      },
    );
    this.grouping = this.createSelect<ResultGrouping>(
      controls,
      'Result grouping',
      { notes: 'Best section per note', passages: 'All sections' },
      this.grouping,
      (value) => {
        this.grouping = value;
        if (this.queryInput?.value.trim()) void this.runSearch();
      },
    );
    this.modifiedFromInput = this.createDateInput(
      controls,
      'Modified from',
    );
    this.modifiedToInput = this.createDateInput(
      controls,
      'Modified to',
    );

    const indexBar = container.createDiv({ cls: 'zg-index-bar' });
    const statusWrap = indexBar.createDiv({ cls: 'zg-index-state' });
    this.statusEl = statusWrap.createDiv({ cls: 'zg-index-message' });
    this.statsEl = statusWrap.createDiv({
      cls: 'zg-index-stats',
      attr: { hidden: '' },
    });
    this.errorEl = statusWrap.createDiv({
      cls: 'zg-index-error',
      attr: { hidden: '' },
    });
    this.progressEl = statusWrap.createEl('progress');
    this.progressEl.hidden = true;
    const actionWrap = indexBar.createDiv({ cls: 'zg-index-actions' });
    this.copyErrorButtonEl = actionWrap.createEl('button', {
      text: 'Copy error',
      attr: {
        hidden: '',
        'aria-label': 'Copy indexing error details',
      },
    });
    this.copyErrorButtonEl.addEventListener('click', () => {
      if (!this.lastErrorText) return;
      void navigator.clipboard.writeText(this.lastErrorText)
        .then(() => new Notice('ZG error details copied.', 2500))
        .catch((error) => {
          console.error('Could not copy ZG error details', error);
          new Notice('Could not copy ZG error details.', 4000);
        });
    });
    this.buildButtonEl = actionWrap.createEl('button', {
      text: 'Build index',
      cls: 'mod-cta',
      attr: { hidden: '', 'aria-label': 'Build the search index' },
    });
    this.buildButtonEl.addEventListener('click', () => {
      void this.plugin.buildIndex();
    });
    this.cancelButtonEl = actionWrap.createEl('button', {
      text: 'Cancel',
      attr: { 'aria-label': 'Cancel indexing' },
    });
    this.cancelButtonEl.hidden = true;
    this.cancelButtonEl.addEventListener(
      'click',
      () => this.plugin.cancelIndexing(),
    );

    this.summaryEl = container.createDiv({ cls: 'zg-search-summary' });
    this.resultsEl = container.createDiv({
      cls: 'zg-search-results',
      attr: { 'aria-live': 'polite' },
    });
  }

  private createSelect<T extends string>(
    container: HTMLElement,
    label: string,
    options: Record<T, string>,
    selected: T,
    onChange: (value: T) => void,
  ): T {
    const wrap = container.createDiv({ cls: 'zg-control' });
    wrap.createEl('label', { text: label });
    const select = wrap.createEl('select', { attr: { 'aria-label': label } });
    for (const [value, text] of Object.entries(options)) {
      select.createEl('option', {
        value,
        text: String(text),
      });
    }
    select.value = selected;
    select.addEventListener('change', () => onChange(select.value as T));
    return selected;
  }

  private createDateInput(
    container: HTMLElement,
    label: string,
  ): HTMLInputElement {
    const wrap = container.createDiv({ cls: 'zg-control' });
    wrap.createEl('label', { text: label });
    const input = wrap.createEl('input', {
      type: 'date',
      attr: {
        'aria-label': `${label}; leave blank for no limit`,
        title: 'Leave blank for no limit',
      },
    });
    input.addEventListener('change', () => {
      if (this.queryInput?.value.trim()) void this.runSearch();
    });
    return input;
  }

  private async runSearch(): Promise<void> {
    const query = (this.queryInput?.value.trim() ?? '').slice(0, 1000);
    if (!query || !this.resultsEl || !this.summaryEl) {
      this.clearSearch();
      return;
    }
    if (this.queryInput && this.queryInput.value !== query) {
      this.queryInput.value = query;
    }
    const generation = this.searchSession.begin(query);
    this.syncClearButton();
    if (this.searchButtonEl) this.searchButtonEl.disabled = true;
    this.resultsEl.empty();
    this.resultsEl.createDiv({ cls: 'zg-search-loading', text: 'Searching…' });
    this.summaryEl.setText('');

    try {
      await this.plugin.ensureRuntimeReady();
      const engine = this.plugin.engine;
      if (!engine) throw new Error('The zg search runtime is unavailable.');
      const dateRange = modifiedDateRangeFromInputs(
        this.modifiedFromInput?.value ?? '',
        this.modifiedToInput?.value ?? '',
      );
      const response = await engine.search({
        query,
        mode: this.mode,
        matchMode: this.matchMode,
        sort: this.sort,
        grouping: this.grouping,
        limit: this.plugin.settings.queryLimit,
        ...dateRange,
      });
      if (!this.searchSession.isCurrent(generation, query)) return;
      this.renderResults(query, response);
    } catch (error) {
      if (!this.searchSession.isCurrent(generation, query)) return;
      const cancelled = Boolean(
        (error as { cancelled?: boolean } | null)?.cancelled,
      );
      const message = error instanceof Error ? error.message : String(error);
      this.resultsEl.empty();
      if (!cancelled) {
        this.resultsEl.createDiv({
          cls: 'zg-search-empty is-error',
          text: `Search failed: ${message}`,
        });
      }
    } finally {
      if (
        this.searchSession.isCurrent(generation, query)
        && this.searchButtonEl
      ) {
        this.searchButtonEl.disabled = false;
      }
    }
  }

  private clearSearch(): void {
    this.searchSession.clear();
    if (this.queryInput) this.queryInput.value = '';
    this.clearRenderedSearch();
    this.syncClearButton();
    this.queryInput?.focus();
  }

  private clearRenderedSearch(): void {
    this.activeResponse = null;
    this.resultPager.clear();
    this.loadMoreButtonEl = null;
    this.resultsEl?.empty();
    this.summaryEl?.empty();
    if (this.searchButtonEl) this.searchButtonEl.disabled = false;
  }

  private syncClearButton(): void {
    if (!this.clearButtonEl) return;
    this.clearButtonEl.disabled = !this.searchSession.hasActiveSearch
      && !(this.queryInput?.value.trim());
  }

  private renderResults(query: string, response: SearchResponse): void {
    if (!this.resultsEl || !this.summaryEl) return;
    this.resultsEl.empty();
    this.activeResponse = response;
    this.resultPager.reset(response.results);
    this.loadMoreButtonEl = null;
    if (response.results.length === 0) {
      this.updateResultSummary(0);
      this.resultsEl.createDiv({
        cls: 'zg-search-empty',
        text: this.mode === 'keyword'
          ? 'No note matches those words. Try Hybrid or Semantic mode.'
          : 'No matching notes found.',
      });
      return;
    }
    this.appendNextResultBatch(query);
  }

  private appendNextResultBatch(query: string): void {
    if (!this.resultsEl || !this.activeResponse) return;
    this.loadMoreButtonEl?.remove();
    this.loadMoreButtonEl = null;
    const page = this.resultPager.next(this.plugin.settings.resultLimit);
    const terms = queryTerms(query);
    for (const result of page.items) {
      this.renderResult(result, terms);
    }
    this.updateResultSummary(page.shown);
    if (page.remaining === 0) return;
    const nextCount = Math.min(
      this.plugin.settings.resultLimit,
      page.remaining,
    );
    this.loadMoreButtonEl = this.resultsEl.createEl('button', {
      cls: 'zg-load-more',
      text: `Load ${nextCount.toLocaleString()} more`,
      attr: {
        type: 'button',
        'aria-label': `Load ${nextCount.toLocaleString()} more search results`,
      },
    });
    this.loadMoreButtonEl.addEventListener(
      'click',
      () => this.appendNextResultBatch(query),
    );
  }

  private updateResultSummary(shown: number): void {
    if (!this.summaryEl || !this.activeResponse) return;
    const response = this.activeResponse;
    const total = response.total.toLocaleString();
    const resultLabel = response.total === 1 ? 'result' : 'results';
    const shownLabel = shown < response.total
      ? ` · showing ${shown.toLocaleString()}`
      : '';
    this.summaryEl.setText(
      `${total} ${resultLabel}${shownLabel} · ${Math.round(response.elapsedMs)} ms`,
    );
  }

  private renderResult(result: SearchResult, terms: string[]): void {
    if (!this.resultsEl) return;
    // A div rather than <button>: themes style buttons aggressively (fixed
    // heights, display overrides) which corrupts card layout and defeats the
    // hidden attribute.
    const card = this.resultsEl.createDiv({ cls: 'zg-result' });
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    const header = card.createDiv({ cls: 'zg-result-header' });
    const titleBlock = header.createDiv({ cls: 'zg-result-heading-block' });
    const title = titleBlock.createDiv({ cls: 'zg-result-title' });
    appendHighlighted(title, result.title, terms);
    if (result.heading) {
      const heading = titleBlock.createDiv({ cls: 'zg-result-heading' });
      appendHighlighted(heading, result.heading, terms);
    }
    const badges = header.createDiv({ cls: 'zg-result-badges' });
    for (const badge of matchBadges(result)) {
      badges.createSpan({ cls: `zg-badge zg-badge-${badge.cls}`, text: badge.text });
    }
    card.createDiv({ cls: 'zg-result-path', text: result.path });
    if (result.preview) {
      const preview = card.createDiv({ cls: 'zg-result-preview' });
      appendHighlighted(preview, result.preview, terms);
    }
    const metadata = card.createDiv({ cls: 'zg-result-meta' });
    if (result.mtime > 0) {
      metadata.createSpan({
        text: `Modified ${new Date(result.mtime).toLocaleDateString()}`,
      });
    }
    if (result.startLine > 0) {
      metadata.createSpan({ text: `Line ${result.startLine}` });
    }
    const activateResult = (event: MouseEvent): void => {
      const activation = resultActivationFor(event);
      if (!activation) return;
      if (activation.preventDefault) event.preventDefault();
      void this.openResult(result, activation.newTab).catch(
        (error) => {
          console.error('ZG Hybrid Search could not open a result', error);
          new Notice(`Could not open ${result.path}`);
        },
      );
    };
    card.addEventListener('click', activateResult);
    card.addEventListener('auxclick', activateResult);
    card.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      void this.openResult(result, false).catch(
        (error) => {
          console.error('ZG Hybrid Search could not open a result', error);
          new Notice(`Could not open ${result.path}`);
        },
      );
    });
  }

  private async openResult(result: SearchResult, newLeaf: boolean): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(result.path);
    if (!(file instanceof TFile)) {
      new Notice(`Note no longer exists: ${result.path}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf(newLeaf);
    await leaf.openFile(file);
    if (leaf.view instanceof MarkdownView && result.startLine > 0) {
      const line = result.startLine - 1;
      leaf.view.editor.setCursor({ line, ch: 0 });
      leaf.view.editor.scrollIntoView({
        from: { line, ch: 0 },
        to: { line, ch: 0 },
      }, true);
    }
  }
}

function matchBadges(
  result: SearchResult,
): { cls: string; text: string }[] {
  const badges: { cls: string; text: string }[] = [];
  const matched = result.matchedBy;
  if (matched === 'fts+vector') {
    badges.push({ cls: 'fts', text: 'keywords' });
    badges.push({ cls: 'vector', text: 'semantic' });
  } else if (matched === 'vector') {
    badges.push({ cls: 'vector', text: 'semantic' });
  } else if (matched === 'fts') {
    badges.push({ cls: 'fts', text: 'keywords' });
  } else if (matched === 'rg') {
    badges.push({ cls: 'fts', text: 'exact' });
  } else if (matched) {
    badges.push({ cls: 'fts', text: matched });
  }
  if (result.stale) badges.push({ cls: 'stale', text: 'stale' });
  return badges;
}

function appendHighlighted(
  container: HTMLElement,
  text: string,
  terms: string[],
): void {
  if (terms.length === 0) {
    container.appendText(text);
    return;
  }
  const escaped = terms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) {
    container.appendText(text);
    return;
  }
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  for (const part of text.split(pattern)) {
    if (!part) continue;
    if (pattern.test(part)) container.createEl('mark', { text: part });
    else container.appendText(part);
    pattern.lastIndex = 0;
  }
}
