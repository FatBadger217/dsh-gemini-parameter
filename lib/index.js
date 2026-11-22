/**
 * dsh-gemini-parameter — a host-only DSH plugin that lets every outbound Google
 * Generative Language request carry official Gemini request fields that DSH has
 * no native way to set: `safetySettings`, an `X-Server-Timeout` header and a
 * validated `officialParams` map (serviceTier, cachedContent, maxOutputTokens,
 * thinkingConfig, ...). It does not patch DSH, pi-ai or @google/genai.
 *
 * Why a fetch wrapper: pi-ai's Google adapter builds the request body itself and
 * offers no payload hook, but @google/genai sends it through an unqualified
 * `fetch()` resolved at call time (dist/node/index.mjs:13877, DEFAULT_FETCHER at
 * :19122). Replacing `globalThis.fetch` for the lifetime of the plugin therefore
 * covers HTTP/SSE calls from every LLM route that speaks the Gemini protocol,
 * including the native `google` route, while leaving every other client
 * untouched (their hosts do not match).
 *
 * The wrapper is deliberately narrow: it only matches configured hosts and
 * `:generateContent` / `:streamGenerateContent` paths, only touches JSON bodies,
 * and passes everything else to the original fetch unchanged. Every injection
 * group can be disabled independently (`safetySettings: false`,
 * `serverTimeoutSeconds: null`, empty `officialParams`).
 */

import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Stable Loader identity (cordis.patch.yml row `name` resolves the package). */
export const name = 'gemini-parameter';

/** This plugin needs no DSH services. */
export const inject = [];

const VERSION = '0.1.0';

const DEFAULT_HOSTS = Object.freeze(['generativelanguage.googleapis.com']);
const DEFAULT_ENDPOINTS = Object.freeze([':generateContent', ':streamGenerateContent']);
const DEFAULT_SERVER_TIMEOUT_SECONDS = 1200;

/** Gemini's four default safety categories (Google's documented defaults). */
const DEFAULT_SAFETY_SETTINGS = Object.freeze([
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
]);

const VALID_THRESHOLDS = new Set([
  'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
  'BLOCK_LOW_AND_ABOVE',
  'BLOCK_MEDIUM_AND_ABOVE',
  'BLOCK_ONLY_HIGH',
  'BLOCK_NONE',
  'OFF',
]);

const CATEGORY_PATTERN = /^HARM_CATEGORY_[A-Z0-9_]+$/;
const HOSTNAME_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const VALID_MODES = new Set(['merge', 'replace', 'insert-only']);
const VALID_BODY_POLICIES = new Set(['skip', 'error']);

/**
 * Official Gemini `GenerateContentRequest` fields that `officialParams` may set
 * at the top level of the JSON body. `generationConfig` is merged key by key.
 * Reference: https://ai.google.dev/api/generate-content
 */
const OFFICIAL_TOP_LEVEL_KEYS = new Set([
  'generationConfig',
  'serviceTier',
  'cachedContent',
  'labels',
  'toolConfig',
]);

/** Official `generationConfig` sub-fields accepted by `officialParams`. */
const OFFICIAL_GENERATION_KEYS = new Set([
  'temperature',
  'topP',
  'topK',
  'candidateCount',
  'maxOutputTokens',
  'stopSequences',
  'responseMimeType',
  'responseSchema',
  'responseJsonSchema',
  'responseModalities',
  'mediaResolution',
  'seed',
  'thinkingConfig',
  'responseLogprobs',
  'logprobs',
  'presencePenalty',
  'frequencyPenalty',
  'enableEnhancedCivicAnswers',
  'speechConfig',
]);

class GeminiParameterError extends Error {
  constructor(message) {
    super(`[gemini-parameter] ${message}`);
    this.name = 'GeminiParameterError';
  }
}

function fail(message) {
  throw new GeminiParameterError(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asHostList(value) {
  if (value === undefined || value === null) return [...DEFAULT_HOSTS];
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) fail('`hosts` must not be empty');
  return list.map((entry) => {
    if (typeof entry !== 'string' || !HOSTNAME_PATTERN.test(entry.trim())) {
      fail(`invalid host entry ${JSON.stringify(entry)} in \`hosts\``);
    }
    return entry.trim().toLowerCase();
  });
}

function asEndpointList(value) {
  if (value === undefined || value === null) return [...DEFAULT_ENDPOINTS];
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) fail('`endpoints` must not be empty');
  return list.map((entry) => {
    if (typeof entry !== 'string' || !entry.startsWith(':') || entry.length < 2) {
      fail(`invalid endpoint ${JSON.stringify(entry)} in \`endpoints\` (expected a ":method" suffix)`);
    }
    return entry;
  });
}

function normalizeCategory(raw) {
  if (typeof raw !== 'string') return undefined;
  const category = raw.trim().toUpperCase();
  return CATEGORY_PATTERN.test(category) ? category : undefined;
}

function normalizeThreshold(raw, label) {
  if (typeof raw !== 'string') fail(`missing threshold for ${label}`);
  const threshold = raw.trim().toUpperCase();
  if (!VALID_THRESHOLDS.has(threshold)) {
    fail(`invalid threshold ${JSON.stringify(raw)} for ${label}; expected one of ${[...VALID_THRESHOLDS].join(', ')}`);
  }
  return threshold;
}

function normalizeSafetySettings(value) {
  // `false` disables the whole safetySettings injection (on-demand passthrough).
  if (value === false) return null;
  if (value === undefined || value === null) {
    return DEFAULT_SAFETY_SETTINGS.map((setting) => ({ ...setting }));
  }
  const entries = [];
  if (isPlainObject(value)) {
    for (const [category, threshold] of Object.entries(value)) entries.push({ category, threshold });
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') entries.push({ category: entry, threshold: 'BLOCK_NONE' });
      else if (isPlainObject(entry)) entries.push({ category: entry.category ?? entry.Category, threshold: entry.threshold ?? entry.Threshold });
      else fail(`invalid safetySettings entry ${JSON.stringify(entry)}`);
    }
  } else {
    fail('`safetySettings` must be an array of {category, threshold} or an object map');
  }
  if (entries.length === 0) fail('`safetySettings` must not be empty');
  const seen = new Set();
  return entries.map((entry) => {
    const category = normalizeCategory(entry.category);
    if (category === undefined) {
      fail(`invalid safety category ${JSON.stringify(entry.category)}; expected HARM_CATEGORY_*`);
    }
    if (seen.has(category)) fail(`duplicate safety category ${category}`);
    seen.add(category);
    return { category, threshold: normalizeThreshold(entry.threshold, category) };
  });
}

function normalizeServerTimeout(value) {
  if (value === undefined) return DEFAULT_SERVER_TIMEOUT_SECONDS;
  if (value === null || value === false || value === 0) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1200) {
    fail(`\`serverTimeoutSeconds\` must be an integer in 1..1200, or null/0 to disable (got ${JSON.stringify(value)})`);
  }
  return value;
}

function cloneJson(value, label) {
  let clone;
  try {
    clone = JSON.parse(JSON.stringify(value));
  } catch {
    fail(`\`${label}\` must be JSON-serializable`);
  }
  if (clone === undefined) fail(`\`${label}\` must be JSON-serializable`);
  return clone;
}

/**
 * Validate the optional `officialParams` map: a small, explicitly whitelisted
 * subset of official Gemini `GenerateContentRequest` fields. Anything else is a
 * typo and fails at mount time instead of being silently forwarded.
 * @param {unknown} value
 */
function normalizeOfficialParams(value) {
  if (value === undefined || value === null) return Object.freeze({});
  if (!isPlainObject(value)) fail('`officialParams` must be an object of official request fields');
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!OFFICIAL_TOP_LEVEL_KEYS.has(key)) {
      fail(`unknown \`officialParams\` key ${JSON.stringify(key)}; expected one of ${[...OFFICIAL_TOP_LEVEL_KEYS].join(', ')}`);
    }
    if (key === 'generationConfig') {
      if (!isPlainObject(raw) || Object.keys(raw).length === 0) {
        fail('`officialParams.generationConfig` must be a non-empty object');
      }
      const generation = {};
      for (const [generationKey, generationValue] of Object.entries(raw)) {
        if (!OFFICIAL_GENERATION_KEYS.has(generationKey)) {
          fail(`unknown \`officialParams.generationConfig\` key ${JSON.stringify(generationKey)}; expected one of ${[...OFFICIAL_GENERATION_KEYS].join(', ')}`);
        }
        generation[generationKey] = cloneJson(generationValue, `officialParams.generationConfig.${generationKey}`);
      }
      out.generationConfig = generation;
      continue;
    }
    out[key] = cloneJson(raw, `officialParams.${key}`);
  }
  return Object.freeze(out);
}

/**
 * Validate and freeze the row `config` of this plugin.
 * @param {unknown} raw - the `config` mapping from cordis.patch.yml.
 */
export function normalizeConfig(raw) {
  const input = isPlainObject(raw) ? raw : {};
  const mode = input.mode ?? 'merge';
  if (!VALID_MODES.has(mode)) {
    fail(`\`mode\` must be one of ${[...VALID_MODES].join(', ')} (got ${JSON.stringify(input.mode)})`);
  }
  const onUnsupportedBody = input.onUnsupportedBody ?? 'skip';
  if (!VALID_BODY_POLICIES.has(onUnsupportedBody)) {
    fail(`\`onUnsupportedBody\` must be "skip" or "error" (got ${JSON.stringify(input.onUnsupportedBody)})`);
  }
  const debugDumpTo = input.debugDumpTo ?? null;
  if (debugDumpTo !== null && (typeof debugDumpTo !== 'string' || debugDumpTo.trim() === '')) {
    fail('`debugDumpTo` must be a file path or null');
  }
  return Object.freeze({
    hosts: asHostList(input.hosts),
    endpoints: asEndpointList(input.endpoints),
    mode,
    safetySettings: normalizeSafetySettings(input.safetySettings),
    serverTimeoutSeconds: normalizeServerTimeout(input.serverTimeoutSeconds),
    officialParams: normalizeOfficialParams(input.officialParams),
    debugDumpTo,
    onUnsupportedBody,
    log: input.log === true,
  });
}

/**
 * Merge the configured settings into a parsed request body.
 * @param {object} body - parsed `generationConfig`-bearing request body.
 * @param {{category: string, threshold: string}[]} settings - configured settings.
 * @param {'merge'|'replace'|'insert-only'} mode
 * @returns {{changed: boolean}} whether `body.safetySettings` was rewritten.
 */
export function applySafetySettingsToBody(body, settings, mode = 'merge') {
  if (!isPlainObject(body)) return { changed: false };
  const existing = Array.isArray(body.safetySettings)
    ? body.safetySettings.filter((entry) => isPlainObject(entry))
    : [];
  if (mode === 'insert-only' && existing.length > 0) return { changed: false };
  const before = JSON.stringify(body.safetySettings ?? null);
  let next;
  if (mode === 'replace') {
    next = settings.map((setting) => ({ ...setting }));
  } else {
    const order = [];
    const merged = new Map();
    for (const entry of existing) {
      const category = normalizeCategory(entry.category);
      if (category === undefined) continue;
      if (!merged.has(category)) order.push(category);
      merged.set(category, entry);
    }
    for (const setting of settings) {
      if (!merged.has(setting.category)) order.push(setting.category);
      merged.set(setting.category, { ...(merged.get(setting.category) ?? {}), ...setting });
    }
    next = order.map((category) => merged.get(category));
  }
  const after = JSON.stringify(next);
  if (before === after) return { changed: false };
  body.safetySettings = next;
  return { changed: true };
}

/**
 * Merge whitelisted official request fields into a parsed request body.
 * Top-level keys are set (they win over whatever the SDK sent); a
 * `generationConfig` block is merged key by key so unrelated SDK fields survive.
 * @param {object} body
 * @param {object} params - validated `officialParams`
 * @returns {{changed: boolean}}
 */
export function applyOfficialParamsToBody(body, params) {
  if (!isPlainObject(body) || params === null || Object.keys(params).length === 0) {
    return { changed: false };
  }
  const before = JSON.stringify(body);
  for (const [key, value] of Object.entries(params)) {
    if (key === 'generationConfig') {
      const generation = isPlainObject(body.generationConfig) ? body.generationConfig : {};
      for (const [generationKey, generationValue] of Object.entries(value)) {
        generation[generationKey] = JSON.parse(JSON.stringify(generationValue));
      }
      body.generationConfig = generation;
      continue;
    }
    body[key] = JSON.parse(JSON.stringify(value));
  }
  return { changed: JSON.stringify(body) !== before };
}

function resolveUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input !== null && typeof input === 'object' && typeof input.url === 'string') return input.url;
  return undefined;
}

function matchesUrl(urlString, config) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  const hostMatched = config.hosts.some((host) => host.startsWith('*.')
    ? hostname === host.slice(2) || hostname.endsWith(host.slice(1))
    : hostname === host);
  if (!hostMatched) return false;
  return config.endpoints.some((endpoint) => parsed.pathname.endsWith(endpoint));
}

async function readBodyText(body, requestLike) {
  if (body !== undefined && body !== null) {
    if (typeof body === 'string') return body;
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return null;
    if (typeof Blob !== 'undefined' && body instanceof Blob) return await body.text();
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
    if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return null;
    return null;
  }
  if (requestLike !== undefined) {
    const method = (requestLike.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return null;
    return await requestLike.clone().text();
  }
  return null;
}

/**
 * Build the patched fetch function.
 * @param {typeof fetch} baseFetch - the fetch captured when the plugin mounts.
 * @param {ReturnType<typeof normalizeConfig>} config
 * @param {{log: (m: string) => void, warn: (m: string) => void}} hooks
 * @returns {{fetch: typeof fetch, stats: object}}
 */
export function createPatchedFetch(baseFetch, config, hooks) {
  const stats = { matched: 0, injected: 0, paramsInjected: 0, timeoutHeaders: 0, unsupported: 0, failed: 0 };
  // Diagnostics only: tells a nested/double mount apart from two real requests.
  const instance = Math.random().toString(36).slice(2, 10);
  let calls = 0;

  async function dump(entry) {
    if (config.debugDumpTo === null) return;
    try {
      await appendFile(config.debugDumpTo, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, 'utf8');
    } catch (error) {
      hooks.warn(`debug dump failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function geminiSafetyFetch(input, init) {
    const url = resolveUrl(input);
    if (url === undefined || !matchesUrl(url, config)) return baseFetch(input, init);
    stats.matched += 1;

    const requestLike = input instanceof Request ? input : undefined;
    let headers;
    try {
      headers = new Headers(init?.headers ?? requestLike?.headers);
    } catch {
      return baseFetch(input, init);
    }

    let timeoutApplied = false;
    if (config.serverTimeoutSeconds !== null && !headers.has('x-server-timeout')) {
      headers.set('x-server-timeout', String(config.serverTimeoutSeconds));
      timeoutApplied = true;
      stats.timeoutHeaders += 1;
    }

    let parsedBody = null;
    let safetyInjected = false;
    let paramsInjected = false;
    try {
      const text = await readBodyText(init?.body, requestLike);
      if (text !== null) {
        const parsed = JSON.parse(text);
        if (isPlainObject(parsed)) {
          parsedBody = parsed;
          if (config.safetySettings !== null) {
            const result = applySafetySettingsToBody(parsed, config.safetySettings, config.mode);
            if (result.changed) {
              safetyInjected = true;
              stats.injected += 1;
            }
          }
          const paramsResult = applyOfficialParamsToBody(parsed, config.officialParams);
          if (paramsResult.changed) {
            paramsInjected = true;
            stats.paramsInjected += 1;
          }
          if (safetyInjected || paramsInjected) headers.delete('content-length');
        } else {
          stats.unsupported += 1;
        }
      } else {
        stats.unsupported += 1;
      }
    } catch (error) {
      stats.failed += 1;
      if (config.onUnsupportedBody === 'error') {
        throw new GeminiParameterError(`cannot inject official params into ${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
      parsedBody = null;
      safetyInjected = false;
      paramsInjected = false;
    }
    const injected = safetyInjected || paramsInjected;

    if (!injected && !timeoutApplied) return baseFetch(input, init);

    const options = { ...(init ?? {}), headers };
    if (injected && parsedBody !== null) options.body = JSON.stringify(parsedBody);

    if (config.log && injected) {
      const safetyNote = safetyInjected
        ? `${config.safetySettings.length} safetySettings (${config.mode})`
        : 'no safetySettings';
      const paramsNote = paramsInjected
        ? `officialParams[${Object.keys(config.officialParams).join(',')}]`
        : 'no officialParams';
      hooks.log(`injected ${safetyNote} + ${paramsNote} into ${url}`);
    }

    const call = ++calls;
    const target = requestLike !== undefined ? new Request(requestLike, options) : input;
    try {
      const response = requestLike !== undefined ? await baseFetch(target) : await baseFetch(target, options);
      if (config.debugDumpTo !== null) {
        await dump({
          instance,
          call,
          url,
          status: response.status,
          injected,
          mode: config.mode,
          xServerTimeout: headers.get('x-server-timeout'),
          safetySettings: safetyInjected ? parsedBody?.safetySettings ?? null : null,
          officialParams: paramsInjected ? config.officialParams : null,
        });
      }
      return response;
    } catch (error) {
      if (config.debugDumpTo !== null) {
        await dump({ instance, call, url, error: error instanceof Error ? error.message : String(error), injected });
      }
      throw error;
    }
  }

  return { fetch: geminiSafetyFetch, stats };
}

/**
 * Cordis entry: wrap `globalThis.fetch` until the plugin is disposed.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} config - the row's `config` mapping.
 */
export function apply(ctx, config) {
  const normalized = normalizeConfig(config);
  const baseFetch = globalThis.fetch;
  if (typeof baseFetch !== 'function') {
    ctx.logger?.warn?.('[gemini-parameter] globalThis.fetch is unavailable; plugin stays inactive');
    return;
  }
  const logger = ctx.logger ?? console;
  const emit = (level) => (message) => {
    try {
      const fn = logger?.[level];
      if (typeof fn === 'function') fn.call(logger, message);
      else console.error(message);
    } catch {
      /* logging must never break requests */
    }
  };
  const patched = createPatchedFetch(baseFetch, normalized, {
    log: emit('info'),
    warn: emit('warn'),
  });
  globalThis.fetch = patched.fetch;
  ctx.effect(() => () => {
    if (globalThis.fetch === patched.fetch) globalThis.fetch = baseFetch;
  }, 'gemini-parameter:fetch');

  const timeout = normalized.serverTimeoutSeconds === null
    ? 'disabled'
    : `${normalized.serverTimeoutSeconds}s`;
  const categories = normalized.safetySettings === null
    ? 'disabled'
    : normalized.safetySettings.map((setting) => setting.category).join(',');
  const params = Object.keys(normalized.officialParams).length === 0
    ? 'off'
    : Object.keys(normalized.officialParams).join(',');
  emit('info')(`[gemini-parameter] v${VERSION} active - hosts=${normalized.hosts.join(',')}`
    + ` endpoints=${normalized.endpoints.join(',')} mode=${normalized.mode}`
    + ` categories=${categories}`
    + ` x-server-timeout=${timeout}`
    + ` official-params=${params}`);

  // ── 配置面板：宿主侧 Typert 服务，动态加载、失败降级 ──
  // panel-service.js 依赖 @deepseek-ai/dsh-typert-protocol（仅 DSH Loader 环境
  // 可解析）。静态 import 会让本地 npm test 直接 ModuleNotFound，所以用动态
  // import：面板挂不上只记一条警告，参数注入主功能完全不受影响。
  let panelDispose = null;
  let disposed = false;
  const panelDeps = {
    configFile: fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)),
    backupDir: fileURLToPath(new URL('../.config-backups/', import.meta.url)),
    activeConfig: normalized,
    stats: patched.stats,
    version: VERSION,
    packageName: 'dsh-gemini-parameter',
    bootTime: Date.now() - process.uptime() * 1000,
    debugDumpTo: normalized.debugDumpTo
  };
  import('./panel-service.js').then((mod) => {
    if (disposed) return;
    // registerPanel 是 async（typert-protocol 三级异步解析，见 panel-service.js）。
    return mod.registerPanel(ctx, panelDeps).then((dispose) => {
      if (!disposed) panelDispose = dispose;
    });
  }).catch((error) => {
    try {
      emit('warn')('[gemini-parameter] 配置面板加载失败（不影响参数注入）: ' + String(error?.message ?? error));
      // 无日志环境（headless 探针）下的可观测证据：写入 debugDumpTo。
      if (typeof normalized.debugDumpTo === 'string' && normalized.debugDumpTo !== '') {
        appendFile(normalized.debugDumpTo, JSON.stringify({
          time: new Date().toISOString(),
          panel: 'geminiParameterPanel',
          state: 'load-failed',
          error: String(error?.message ?? error)
        }) + '\n', 'utf8').catch(() => { /* 诊断写失败绝不影响主流程 */ });
      }
    } catch { /* never break the plugin */ }
  });
  return () => {
    disposed = true;
    try {
      if (typeof panelDispose === 'function') panelDispose();
    } catch { /* cleanup must not throw */ }
  };
}
