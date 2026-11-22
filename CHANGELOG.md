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
