# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## Versioning policy

- This project follows [Semantic Versioning](https://semver.org/).
- While the project is in the `0.x` series, **minor releases (`0.x`) may contain
  breaking changes** — read this changelog before upgrading.
- From `1.0` on, strict semver applies: breaking changes only ship in major
  versions.

## [Unreleased]

### Changed

- Publish readiness: removed the `private: true` guard from `package.json`
  (npm release prep, no functional change) and added a GitHub Actions workflow
  (`.github/workflows/publish.yml`) that publishes to npm automatically when a
  release is published.
- 发布准备：摘除 `package.json` 中的 `private: true` 保险丝（无功能变化），新增
  GitHub Actions 自动发布工作流（`.github/workflows/publish.yml`，随 Release
  自动发布 npm）。

### Documentation

- 0.1.1 is live on npm (published 2026-11-24): installation instructions across
  both READMEs, the usage manual, the maintainer notes and the bundle patch
  comment now lead with `dsh plugin ... add dsh-gemini-parameter` (npm) and
  keep the GitHub source install as the alternative; npm version/downloads
  badges added to both READMEs.
- 0.1.1 已上架 npm（2026-11-24 发布）：双语 README、使用说明、维护文档与补丁
  注释中的安装命令均改为以 npm 安装为主（`dsh plugin ... add
  dsh-gemini-parameter`）、GitHub 源码安装保留为备选；双语 README 顶部新增
  npm 版本与下载量徽章。

## [0.1.1] - 2026-11-22

### Added

- `relayUnwrap` configuration (default off): coexistence with in-host model proxies
  such as billion-context, which hand requests down the fetch chain with the URL
  rewritten to `<loopback>/bili/<original-url>`. With a prefix configured (e.g.
  `["/bili/"]`), the whitelist match falls back to the embedded original URL and
  injection works behind the proxy.
- Relay detection: requests rewritten with a `/bili/` marker are counted in a new
  `relaySpotted` statistic while the compat is off, and the config panel shows a
  warning card explaining how to enable it (see upstream analysis
  [ranxianglei/billion-context#7527](https://github.com/ranxianglei/billion-context/issues/7527)).
- The overview card ("currently effective settings") now shows `relayUnwrap`: the
  active prefixes, a plain-language purpose note, and known-target annotations
  (`/bili/` → billion-context).
- 概览卡（「当前生效配置」）新增 `relayUnwrap` 行：显示已启用前缀、用途说明，
  以及已知前缀的目标插件标注（`/bili/` → billion-context）。
- README (both languages) and the usage manual now document the general recipe for
  coexisting with URL-rewriting plugins — spot the symptom, find the prefix,
  enable, verify — with billion-context as the worked example.
- README（双语）与使用说明补充「与会改写请求网址的插件共存」的通用配置方法
  （发现症状 → 找到前缀 → 开启 → 验证），并以 billion-context 为完整实例。

### Fixed

- The config panel could not save `relayUnwrap` (T6 of the 0.1.0 acceptance
  run): the `emitConfigBlock` serializer omitted the key, so the read-back
  verification always saw an empty list and correctly aborted the write with
  `[WRITE_UNSAFE] … [VERIFY_FAILED]`. The key is now emitted after `endpoints`
  (empty/default values stay unemitted, keeping default configs clean), and
  round-trip tests cover both empty and non-empty values.
- 配置面板无法保存 `relayUnwrap`（0.1.0 真机验收 T6 项）：
  `emitConfigBlock` 序列化器漏掉该键，回读校验只能得到空列表，防写坏管线按设计
  以 `[WRITE_UNSAFE] … [VERIFY_FAILED]` 中止写入。现于 `endpoints` 之后补输出该键
  （空值/缺省时不输出，保持默认配置干净），并补充空/非空两种
  写入→回读→再序列化一致性单测。
- The panel version badge was stuck at `v0.1.0`: the host side hardcoded its own
  version constant. The version is now derived from `package.json` (single source
  of truth; the client-side fallback literal synced), so future bumps cannot be
  forgotten again.
- 面板版本徽章停留在 `v0.1.0`：宿主侧版本号是独立硬编码常量。现改为从
  `package.json` 派生（单一事实来源；客户端兜底常量同步更新），此后升版不会再漏改。

## [0.1.0] - 2026-11-22

### Added

Initial public release. The feature set below was developed and hardened during
an internal development stage before being published as this first public
version; the internal version history is intentionally not part of the public
record.

- Global `fetch` wrapper that only applies to JSON requests hitting
  `:generateContent` / `:streamGenerateContent` on
  `generativelanguage.googleapis.com` (host + endpoint whitelist; `hosts`
  entries support `*.` wildcard prefixes); all other traffic passes through
  untouched, and no DSH / pi-ai / `@google/genai` package is modified.
- `safetySettings` injection with five accepted notations (`false` = disable the
  whole group, object map, object array, plain-string array shorthand, and
  `Category` / `Threshold` key-case variants), six threshold levels (including
  `OFF`), and three injection modes: `merge` / `replace` / `insert-only`.
- `X-Server-Timeout` request header via `serverTimeoutSeconds` (integer
  `1..1200`; `0` / `null` / `false` disables the header).
- `officialParams` whitelist passthrough: top-level `serviceTier` /
  `cachedContent` / `labels` / `toolConfig` plus 19 whitelisted
  `generationConfig` sub-keys (`maxOutputTokens`, `thinkingConfig`,
  `mediaResolution`, `responseModalities`, ...); unknown keys fail at mount
  time instead of being silently sent to Google.
- `debugDumpTo` JSONL diagnostic log per processed request (URL, status,
  injected fields — never prompt content).
- Config panel on the plugin's detail page in DSH (below the plugin
  description): config overview / editing / saving with authoritative
  server-side validation / reset-to-defaults / open-config-file, plus a
  restart-required notice after saving.
- Config writes go through an atomic pipeline (timestamped backup → temp file
  → atomic rename → read-back verification); backups land in
  `.config-backups/`.
- Zero runtime dependencies; 37 unit tests (local mocks, no network access).
