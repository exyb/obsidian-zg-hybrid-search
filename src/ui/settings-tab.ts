import { Notice, PluginSettingTab, Setting, type DropdownComponent } from 'obsidian';
import type ZgHybridSearchPlugin from '../../main';
import {
  formatGlobList,
  normalizeSettings,
  parseGlobList,
} from '../settings';
import type {
  EmbeddingDevice,
  MatchMode,
  ResultGrouping,
  SearchMode,
  SortOrder,
} from '../types';
import { resolveToolchain } from '../zg/locate';

const EMBEDDING_MODELS: Record<string, string> = {
  'local/potion-multilingual-128m':
    'potion-multilingual-128m (default, multilingual)',
  'local/potion-code-16m-v2': 'potion-code-16m-v2 (small, fast)',
  'local/potion-retrieval-32m': 'potion-retrieval-32m (higher quality)',
  'local/all-minilm-l6-v2': 'all-minilm-l6-v2 (English)',
  'local/multilingual-e5-small': 'multilingual-e5-small (multilingual)',
  'local/gte-modernbert-base': 'gte-modernbert-base (large)',
};

interface ScopeDraft {
  includeGlobs: string;
  excludeGlobs: string;
  embeddingModel: string;
}

function addOptions(
  dropdown: DropdownComponent,
  options: Record<string, string>,
): void {
  for (const [value, label] of Object.entries(options)) {
    dropdown.addOption(value, label);
  }
}

export class ZgSearchSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: ZgHybridSearchPlugin) {
    super(plugin.app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const draft: ScopeDraft = {
      includeGlobs: formatGlobList(this.plugin.settings.includeGlobs),
      excludeGlobs: formatGlobList(this.plugin.settings.excludeGlobs),
      embeddingModel: this.plugin.settings.embeddingModel,
    };

    new Setting(containerEl)
      .setName('zg CLI')
      .setDesc(
        'Path to the zg (zvec-grep) executable. Leave blank to auto-detect it '
          + 'on PATH and in common install locations such as nvm.',
      )
      .addText((text) => text
        .setPlaceholder('Auto-detect')
        .setValue(this.plugin.settings.zgPath)
        .onChange(async (value) => {
          this.plugin.settings.zgPath = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText('Detect')
        .onClick(async () => {
          new Notice('Locating zg…');
          try {
            const toolchain = await resolveToolchain(
              this.plugin.settings.zgPath,
            );
            new Notice(`Found zg ${toolchain.version}: ${toolchain.zgPath}`);
          } catch (error) {
            new Notice(`zg not found: ${(error as Error).message}`, 8000);
          }
        }));

    containerEl.createEl('h3', { text: 'Index scope' });

    new Setting(containerEl)
      .setName('Embedding model')
      .setDesc(
        'Used when an index is first built. Changing it requires a rebuild '
          + '(the model downloads once, on first use).',
      )
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(EMBEDDING_MODELS)) {
          dropdown.addOption(value, label);
        }
        if (!(draft.embeddingModel in EMBEDDING_MODELS)) {
          dropdown.addOption(draft.embeddingModel, draft.embeddingModel);
        }
        dropdown
          .setValue(draft.embeddingModel)
          .onChange(async (value) => {
            draft.embeddingModel = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Include globs')
      .setDesc('One glob per line, e.g. *.md or project/**. Controls which files are indexed.')
      .addTextArea((textarea) => textarea
        .setValue(draft.includeGlobs)
        .onChange(async (value) => {
          draft.includeGlobs = value;
        }));

    new Setting(containerEl)
      .setName('Exclude globs')
      .setDesc('One vault-relative glob per line, e.g. .trash/** or Archive/**.')
      .addTextArea((textarea) => textarea
        .setValue(draft.excludeGlobs)
        .onChange(async (value) => {
          draft.excludeGlobs = value;
        }));

    new Setting(containerEl)
      .setName('Automatic incremental indexing')
      .setDesc('Keep the index updated automatically after notes change.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoIndex)
        .onChange(async (value) => {
          this.plugin.settings.autoIndex = value;
          await this.plugin.saveSettings();
        }));

    const applySetting = new Setting(containerEl)
      .setName('Apply scope and rebuild')
      .setDesc(
        'Saves include/exclude globs and the embedding model, then drops and '
          + 'rebuilds the index.',
      )
      .addButton((button) => button
        .setButtonText('Save and rebuild')
        .setCta()
        .onClick(async () => {
          this.plugin.settings.includeGlobs = parseGlobList(draft.includeGlobs);
          this.plugin.settings.excludeGlobs = parseGlobList(draft.excludeGlobs);
          this.plugin.settings.embeddingModel = draft.embeddingModel;
          await this.plugin.saveSettings();
          this.display();
          await this.plugin.rebuildIndex();
        }));
    applySetting.setDisabled(false);

    containerEl.createEl('h3', { text: 'Index actions' });

    new Setting(containerEl)
      .setName('Incremental reindex')
      .setDesc('Index added, modified, and deleted notes now.')
      .addButton((button) => button
        .setButtonText('Reindex')
        .onClick(async () => {
          await this.plugin.runIncrementalIndex(false);
        }));

    new Setting(containerEl)
      .setName('Reset and rebuild index')
      .setDesc('Drops the existing index and builds a new one with current settings.')
      .addButton((button) => button
        .setButtonText('Rebuild')
        .onClick(async () => {
          await this.plugin.rebuildIndex();
        }));

    containerEl.createEl('h3', { text: 'Search defaults' });

    new Setting(containerEl)
      .setName('Default search mode')
      .addDropdown((dropdown) => {
        addOptions(dropdown, {
          hybrid: 'Hybrid',
          keyword: 'Keywords',
          semantic: 'Semantic',
        } as Record<SearchMode, string>);
        dropdown
          .setValue(this.plugin.settings.defaultMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultMode = value as SearchMode;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Default match')
      .addDropdown((dropdown) => {
        addOptions(dropdown, {
          terms: 'Terms (ranked)',
          phrase: 'Exact phrase',
        } as Record<MatchMode, string>);
        dropdown
          .setValue(this.plugin.settings.defaultMatchMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultMatchMode = value as MatchMode;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Default sort order')
      .addDropdown((dropdown) => {
        addOptions(dropdown, {
          relevance: 'Relevance',
          'modified-desc': 'Modified: newest',
          'modified-asc': 'Modified: oldest',
          'created-desc': 'Created: newest',
          'created-asc': 'Created: oldest',
          'title-asc': 'Title: A–Z',
          'title-desc': 'Title: Z–A',
        } as Record<SortOrder, string>);
        dropdown
          .setValue(this.plugin.settings.defaultSort)
          .onChange(async (value) => {
            this.plugin.settings.defaultSort = value as SortOrder;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Default result grouping')
      .addDropdown((dropdown) => {
        addOptions(dropdown, {
          notes: 'Best section per note',
          passages: 'All sections',
        } as Record<ResultGrouping, string>);
        dropdown
          .setValue(this.plugin.settings.defaultGrouping)
          .onChange(async (value) => {
            this.plugin.settings.defaultGrouping = value as ResultGrouping;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Results per batch')
      .addSlider((slider) => slider
        .setLimits(5, 50, 5)
        .setValue(this.plugin.settings.resultLimit)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.resultLimit = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Maximum results per query')
      .setDesc(
        'Upper bound of hits fetched from zg per search. Sorting by date or '
          + 'title applies within this candidate set.',
      )
      .addSlider((slider) => slider
        .setLimits(10, 200, 10)
        .setValue(this.plugin.settings.queryLimit)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.queryLimit = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Advanced' });

    new Setting(containerEl)
      .setName('Embedding device')
      .addDropdown((dropdown) => {
        addOptions(dropdown, {
          auto: 'Auto',
          cpu: 'CPU',
          metal: 'Metal',
          vulkan: 'Vulkan',
          cuda: 'CUDA',
        } as Record<EmbeddingDevice, string>);
        dropdown
          .setValue(this.plugin.settings.device)
          .onChange(async (value) => {
            this.plugin.settings.device = value as EmbeddingDevice;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Model cache directory')
      .setDesc('Empty uses zg\'s default (~/.zvec-grep/models).')
      .addText((text) => text
        .setPlaceholder('Default')
        .setValue(this.plugin.settings.modelCachePath)
        .onChange(async (value) => {
          this.plugin.settings.modelCachePath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Indexing quiet period')
      .setDesc('Milliseconds to wait after the last edit before reindexing.')
      .addSlider((slider) => slider
        .setLimits(1000, 60000, 1000)
        .setValue(this.plugin.settings.quietPeriodMs)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.quietPeriodMs = value;
          await this.plugin.saveSettings();
        }));
  }
}
