# 开发与打包文档（DEVELOPMENT.md）

面向维护者的笔记：构建、打包、安装到 vault、发布、zg 集成要点、测试与排障。
用户视角的安装/使用说明见 [README.md](README.md)。

## 项目概览

复刻 `reference/obsidian-zvec-hybrid-search` 的功能与 UI，但检索层全部委托给
系统安装的 **zg（zvec-grep）CLI**（zvec + ripgrep + BM25 + 向量），插件自身
不内嵌 Node runtime、不做模型下载管理。构建产物只有一个 `main.js`（esbuild
打包，约 43KB），无运行时 npm 依赖。

```
main.ts                     插件入口：命令/ribbon/视图注册、事件接线、状态发布
src/types.ts                设置/搜索/索引状态类型与默认值
src/settings.ts             设置归一化（loadData 后的防御性校验）
src/zg/locate.ts            定位 zg + node 解释器（含 nvm 展开、Windows cmd 处理）
src/zg/runner.ts            子进程运行器（taskKey 互斥、超时、取消、行回调）
src/zg/args.ts              拼 zg query / index / drop 参数
src/zg/parse.ts             解析 agent-markdown 输出（query/rg/status/index 进度）
src/search/engine.ts        SearchRequest → zg 子进程 → SearchResult 排序聚合
src/indexing/index-manager.ts  索引生命周期：状态探测、增量、重建、删除、静默期调度
src/ui/search-view.ts       侧栏搜索视图（徽章/分页/定位打开）
src/ui/settings-tab.ts      设置页
scripts/smoke.ts            真实 zg 端到端冒烟（合成 vault）
scripts/install-local.mjs   拷贝三个产物文件到指定 vault
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run build` | 生产构建（生成 `main.js`） |
| `npm run dev` | watch 模式构建 |
| `npm run typecheck` | tsc --noEmit |
| `npm test` | 单元测试（node:test，经 tsx 加载） |
| `npm run smoke` | 真实 zg 端到端冒烟（合成 vault，自动清理） |
| `npm run verify` | typecheck + test + build 全套 |
| `npm run package` | build + 打出 `zg-hybrid-search-<version>.zip` |
| `npm run install:vault -- <vault路径>` | 把 main.js/manifest.json/styles.css 装进 `<vault>/.obsidian/plugins/zg-hybrid-search/` |

## 打包与导入 Obsidian

Obsidian 手动安装只需要三个文件：`main.js`、`manifest.json`、`styles.css`。

**方式一：zip**

```bash
npm run package        # 产出 zg-hybrid-search-1.0.0.zip（三个文件在压缩包根部）
```

解压到 `<vault>/.obsidian/plugins/zg-hybrid-search/`，重启 Obsidian，
在 设置 → 第三方插件 中启用 **ZG Hybrid Search**。

**方式二：脚本直装（推荐日常开发）**

```bash
npm run build
npm run install:vault -- /path/to/vault
```

**更新插件**：重新 build 后覆盖三个文件并重启，索引（`<vault>/.zvec-grep/`）
会保留。

**发布到 GitHub（BRAT 可装）**：tag 名与 manifest.json 的 version 保持一致，
把 `zg-hybrid-search-<version>.zip` 挂到对应 GitHub Release，三个文件保持在
zip 根部（当前 package 脚本已满足）。参考 obsidian-zvec-hybrid-search 的
release/BRAT 流程。

## zg 集成要点（踩过的坑）

环境事实：本机 zg 装在 **nvm** 里：`~/.nvm/versions/node/v22.21.1/bin/zg`
（npm 包 `@zvec/zvec-grep`，入口 JS 带 `#!/usr/bin/env node` shebang）。
GUI 启动的 Obsidian 的 PATH 通常不含 nvm，因此 `locate.ts` 会：
1) 展开 `~/.nvm/versions/node/*/bin/zg`（版本号排序取最新）；
2) 找到可用的 `node` 后，用 `node <zg入口.js>` 方式启动，避免依赖 shebang 解析。

zg 0.2.2 CLI 行为（解析器依赖这些事实，升级 zg 时需复核）：

- **工作区根由 cwd 决定**，没有 `--root` 参数。插件所有子进程都以 vault 根
  为 cwd。
- **索引位置固定**：`<vault>/.zvec-grep/`（index.zvec、files.zvec、manifest）。
  模型缓存在 `~/.zvec-grep/models/`，可用 `--model-cache` 覆盖。
- **退出码不可信**：`zg query` 无索引时也返回 0，错误通过 stdout 的
  `Error: … / Code: … / Details: …` 块表达（见 `runner.ts` 的
  `zgErrorMessage`）。
- **新鲜度页脚在 stderr**：`status: possibly_stale`、`results: …`、
  `background_refresh: …` 输出到 stderr；stdout 里的 per-item
  `status: possibly_stale` 才是单个命中的标记，且出现在 heading 之前。
- **机器可读输出只有 agent markdown**（默认），无 JSON 选项；`--human` 是
  给人看的另一套格式。解析器只针对 agent markdown，样例固化在
  `test/parse.test.ts`。
- 查询输出结构：`query groups (n):` → `Q1 [role]: query` → `hits: n` →
  逐个命中块 `#rank matchedBy=… path:start-end` + `heading:/heading_level:/
  scope:` + `outline:`/编号源码行 `LINENO\ttext`（`--preview full`）。
  rg 模式输出是另一套：裸文件路径 + 缩进块 `  start-end [heading …]` +
  `    LINENO:text`。
- 元数据文本带反斜杠转义（`\#` 等），`unescapeZgText` 还原。
- 模式映射：hybrid=位置参数；keywords=`--fts`；semantic=`--vector`；
  exact phrase=`--rg -F "phrase"`（此时 include/exclude globs 用 `-g` 传入）。
  日期过滤 `--modified-after/--modified-before`（接受 epoch 毫秒）。
- `zg index`（不带 --rebuild）本身就是增量：扫描变更文件，只嵌入新/改片段；
  `--drop --yes` 删除索引。
- **进度输出在 stderr**：`Scanning files... / Preparing <model> /
  Indexing complete` 及模型下载进度（`\r` 刷新）都走 stderr，摘要表
  （`files\t… / entities\t… / duration\t…`）走 stdout。runner 因此把两个流
  都喂给 onLine，索引状态栏才能实时显示进度。
- **markdown 命中范围是整个 section**：长段落里 `path:1-39` 这类范围和
  `--preview short` 固定取段首窗口，都与真实匹配行脱节。引擎改用
  `--preview full` 拿整段带行号文本，`anchorPreview`（src/search/engine.ts）
  选出命中查询词最多的一行作为预览窗口锚点和跳转行号。
- 嵌入模型：默认 `local/potion-multilingual-128m`（多语言，约 500MB，首次
  使用时 zg 自动下载到模型缓存）。已有索引沿用建索引时的模型，换模型需
  drop + 重建（设置页的 Save and rebuild）。

## 索引与数据位置

- 索引在 vault 内 `.zvec-grep/`（点目录，Obsidian 不显示）。vault 走同步
  （Dropbox/iCloud/remotely-save 等）时建议在同步端排除该目录，可随时重建。
- 模型缓存在 `~/.zvec-grep/models/`（或设置中的 modelCachePath），在 vault 外。
- 插件自身只通过 Obsidian 的 saveData 存设置，不存索引状态。

## 测试

- 单元测试：`npm test`（node:test + tsx；**必须走 tsx**，Node 原生
  strip-only 模式不支持 TS 参数属性语法）。覆盖：parse（两种输出格式/
  status/进度）、args、settings/text、UI 纯逻辑（pager/session/date-range/
  activation/sort）。
- 冒烟：`npm run smoke` 用插件自己的模块在 /tmp 合成 vault 上跑完整链路
  （建索引 → 四种模式查询 → 排除/日期过滤 → 增量拾取新文件 → rebuild →
  drop → 清理）。需要本机已装 zg；potion-multilingual-128m 已在模型缓存中。

## 排障

- **zg not found**：装好后用设置页 Detect 按钮验证；GUI PATH 问题直接在
  设置里填完整路径。
- **搜索报 WORKSPACE_INDEX_NOT_FOUND**：索引未建。侧栏状态栏 Build index，
  或命令面板执行增量 reindex。
- **刚改的笔记搜不到**：静默期默认 10s；命令面板手动
  "Incrementally reindex notes"。
- **范围不对**：改 include/exclude globs 后必须 Save and rebuild（查询时的
  `-g` 过滤救不了旧索引里已收录的文件）。

## 约定

- TypeScript strict + noUncheckedIndexedAccess；esbuild CJS 输出到根目录
  main.js；`obsidian`/`electron`/CodeMirror 为 external。
- 样式类前缀 `zg-`，与参考插件的 `zvec-` 对应。
- manifest id 为 `zg-hybrid-search`；版本三处同步：package.json、
  manifest.json、versions.json。
