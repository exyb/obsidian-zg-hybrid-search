# ZG Hybrid Search for Obsidian

ZG Hybrid Search helps you find notes using exact words, related terms, or
similar ideas. Search runs locally through the [zg (zvec-grep)](https://github.com/zvec-ai/zvec-grep)
CLI, the index updates automatically as you edit, and there is no separate
server or in-plugin model setup.

This plugin is a light-weight alternative to embedding-based plugins: instead
of bundling its own runtime and embedding stack, it drives the `zg` command
line tool you install once on your machine. zg unifies ripgrep, BM25 full-text
search, and vector search behind one interface, backed by
[zvec](https://github.com/alibaba/zvec).

## What it does

- Finds notes using words, meaning, or a combination of both (hybrid).
- Searches note content and headings; results open at the matching section.
- Updates the index automatically when notes are created, edited, renamed, or
  deleted.
- Lets you include or exclude folders with ripgrep-style globs.
- Offers Hybrid, Keywords, Semantic, and Exact-phrase (ripgrep) search modes.
- Limits results by the note's modified date.
- Sorts results by relevance, date, or title (within the fetched candidate
  set).
- Keeps note text and the search index on your computer.

## Requirements

- Obsidian desktop 1.8.0 or newer (desktop only; mobile is not supported).
- The [zg CLI](https://www.npmjs.com/package/@zvec/zvec-grep) installed and on
  your machine:

  ```bash
  npm install -g @zvec/zvec-grep
  ```

  Requires Node.js 22 or newer. The plugin auto-detects `zg` on PATH and in
  common install locations (including nvm); you can also set an explicit path
  under Settings → ZG Hybrid Search.

## Install

1. Build the plugin or download a release bundle.
2. Copy `main.js`, `manifest.json`, and `styles.css` into
   `<vault>/.obsidian/plugins/zg-hybrid-search/`.
3. Restart Obsidian and enable **ZG Hybrid Search** in
   Settings → Community plugins.

### Building from source

```bash
npm install
npm run verify   # typecheck + tests + production build
```

For development, copy the built files into a test vault:

```bash
npm run build
cp main.js styles.css manifest.json \
  "<your-vault>/.obsidian/plugins/zg-hybrid-search/"
```

## What happens after installation

When the plugin is enabled it locates `zg`, checks the workspace index, and —
if automatic indexing is on — builds the initial index. The first build
downloads the embedding model you selected (for example
`potion-multilingual-128m`, about 500 MB) once, directly from within `zg`.
Open **ZG Hybrid Search** from the ribbon or run **Open hybrid search** from
the command palette; the sidebar shows progress and lets you search once the
status reads **Index ready**.

## Search your vault

1. Open the ZG Hybrid Search sidebar.
2. Type a query and press **Enter** or select **Search**.
3. Select a result to open the note at the matching line
   (middle-click or Ctrl/Cmd-click opens it in a new tab).

Use **Load more** when there are more results than the current batch. Use
**Clear**, or press **Escape**, to reset the query and results. Changing a
completed query clears its old results immediately.

### Search options

- **Hybrid** (default) combines keyword and semantic matching.
- **Keywords** searches for the query words (BM25).
- **Semantic** searches by meaning.
- **Match: Terms** ranks results across all query words; **Exact phrase**
  routes through managed ripgrep for a literal, exhaustive match.
- **Sort order** re-orders the fetched candidate set by date or title.
- **Result grouping** shows either the best section per note or every
  matching section.
- **Modified from / to** restrict results by note modification date.

Results show a badge for how they matched — `keywords`, `semantic`, both, or
`exact` — plus a `stale` badge when the index was being refreshed.

## Settings

Open **Settings → ZG Hybrid Search**.

- **zg CLI:** path override plus a Detect button that reports the located
  version.
- **Index scope:** embedding model, include globs (default `*.md`), exclude
  globs (default `.trash/**`), and automatic incremental indexing. Scope
  changes require **Save and rebuild**.
- **Search defaults:** mode, match, sort, grouping, results per batch, and
  the maximum fetched per query.
- **Advanced:** embedding device, model cache directory, and the indexing
  quiet period (how long edits must settle before a reindex runs).

## Where data lives

- The index is stored by zg in `<vault>/.zvec-grep/`. The folder starts with a
  dot, so Obsidian does not show it; if your vault is synced (Dropbox, iCloud,
  remotely-save, …) consider excluding `.zvec-grep/` from sync — it can be
  rebuilt at any time.
- Downloaded embedding models live in `~/.zvec-grep/models/` (or the model
  cache directory you configure), outside the vault.
- The plugin stores only its settings via Obsidian's plugin data.

## Privacy

- Search and indexing run locally through the `zg` process. Note content is
  never uploaded; local models never send data anywhere.
- The plugin has no telemetry or analytics.

## Troubleshooting

### "zg not found"

Install it (`npm install -g @zvec/zvec-grep`), then use the **Detect** button
in settings. If Obsidian was launched from a desktop launcher that lacks your
shell's PATH, set the full path in settings.

### A recently edited note is missing

Automatic indexing waits for the quiet period (10 seconds by default). If it
is still missing, run **Incrementally reindex notes** from the command palette.

### The wrong folders are being searched

Adjust **Include globs** / **Exclude globs** in settings, then use **Save and
rebuild**.

### Search errors mention WORKSPACE_INDEX_NOT_FOUND

The index has not been built yet. Use **Build index** in the sidebar status
bar, or run `zg index --embedding local/potion-multilingual-128m` in the vault
root.

## Differences from the bundled-runtime approach

Projects such as obsidian-zvec-hybrid-search bundle a Node runtime and
Transformers.js inside the plugin. This plugin instead delegates indexing and
retrieval to the shared `zg` installation, so:

- no runtime or model downloads are managed by the plugin itself;
- the same index can be used from a terminal (`zg query`) or by coding agents;
- plugin updates are small, and indexing behavior follows the zg version you
  have installed.

## Development

```bash
npm run verify   # typecheck + unit tests + production build
npm run smoke    # end-to-end run against a real zg on a synthetic vault
```

Packaging, vault installation, release flow, and zg integration notes are
documented in [DEVELOPMENT.md](DEVELOPMENT.md) (Chinese).

## License

MIT. See [LICENSE](LICENSE).
