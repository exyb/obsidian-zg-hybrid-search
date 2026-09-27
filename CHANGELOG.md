# Changelog

## 1.0.0 — 2026-09-27

Initial release.

- Hybrid, keyword, semantic, and exact-phrase (ripgrep) search via the
  `zg` (zvec-grep) CLI.
- Automatic incremental indexing with a configurable quiet period, plus
  manual reindex and rebuild commands.
- Sidebar search view with result previews, match badges, load-more paging,
  and jump-to-line result activation (new-tab aware).
- Settings for the zg binary path, embedding model and device, include and
  exclude globs, search defaults, and date-range filtering.

### Fixes during initial iteration

- Index progress now streams: zg prints `Scanning files… / Preparing … /
  Indexing complete` and model-download progress to stderr, which the runner
  previously ignored. The status bar publishes an "Updating the index…"
  message immediately and follows live progress.
- Search results auto-refresh in the sidebar once an index run finishes.
- Result previews and jump-to-line target are anchored at the line matching
  the most query terms, instead of the section start (zg reports whole
  markdown sections as the hit range).
- Result cards render as divs with `role=button` and the view enforces
  `[hidden] { display: none !important }`: themes that set `display` or fixed
  heights on `button` elements corrupted card layout and defeated hidden
  toggles for the status-bar buttons.
- Preview clipping uses `max-height` + `overflow: hidden`; `-webkit-line-clamp`
  is unreliable inside button containers.
