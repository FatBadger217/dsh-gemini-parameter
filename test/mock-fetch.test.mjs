/**
 * Unit tests for dsh-gemini-parameter. No network: fetch is mocked.
 * Run from the package root:  node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  apply,
  applySafetySettingsToBody,
  createPatchedFetch,
  normalizeConfig,
} from '../lib/index.js';

const GOOGLE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:streamGenerateContent?alt=sse';

function captureFetch(body = '{}') {
  const calls = [];
  const fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { calls, fetch };
}

function googleRequest() {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } }),
  };
}

function makeContext() {
  return {
    disposers: [],
    effect(callback) {
      this.disposers.push(callback());
      return this.disposers.at(-1);
    },
    logger: { info() {}, warn() {} },
  };
}

test('normalizeConfig applies defaults and validates', () => {
  const config = normalizeConfig(undefined);
  assert.deepEqual(config.hosts, ['generativelanguage.googleapis.com']);
  assert.equal(config.safetySettings.length, 4);
  assert.equal(config.serverTimeoutSeconds, 1200);
  assert.equal(config.mode, 'merge');
  assert.throws(() => normalizeConfig({ serverTimeoutSeconds: 0 - 1 }), /serverTimeoutSeconds/);
  assert.throws(() => normalizeConfig({ safetySettings: [{ category: 'NOPE', threshold: 'BLOCK_NONE' }] }), /invalid safety category/);
  assert.throws(() => normalizeConfig({ safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'DROP' }] }), /invalid threshold/);
  assert.throws(() => normalizeConfig({ mode: 'append' }), /`mode`/);
  assert.throws(() => normalizeConfig({ hosts: ['bad host!'] }), /invalid host/);
});

test('injects safetySettings and X-Server-Timeout into a Google JSON request', async () => {
  const { calls, fetch } = captureFetch();
  const config = normalizeConfig({ serverTimeoutSeconds: 900 });
  const patched = createPatchedFetch(fetch, config, { log() {}, warn() {} });
  const original = globalThis.fetch;
  globalThis.fetch = patched.fetch;
  try {
    const response = await globalThis.fetch(GOOGLE_URL, googleRequest());
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls.length, 1);
  const init = calls[0].init;
  const body = JSON.parse(init.body);
  assert.equal(body.safetySettings.length, 4);
  assert.deepEqual(body.safetySettings.map((entry) => entry.category).sort(), [
    'HARM_CATEGORY_DANGEROUS_CONTENT',
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  ]);
  assert.equal(body.safetySettings.every((entry) => entry.threshold === 'BLOCK_NONE'), true);
  const headers = new Headers(init.headers);
  assert.equal(headers.get('x-server-timeout'), '900');
  assert.equal(headers.has('content-length'), false);
  assert.equal(patched.stats.injected, 1);
});

test('leaves non-Google and non-matching endpoints untouched', async () => {
  const { calls, fetch } = captureFetch();
  const config = normalizeConfig(undefined);
  const patched = createPatchedFetch(fetch, config, { log() {}, warn() {} });
  const init = { method: 'POST', body: '{"contents":[]}' };
  await patched.fetch('https://api.openai.com/v1/chat/completions', init);
  await patched.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:countTokens', init);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init, init);
  assert.equal(calls[1].init, init);
});

test('merge keeps existing safetySettings and fills missing categories', () => {
  const body = {
    safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }],
  };
  const settings = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
  ];
  const result = applySafetySettingsToBody(body, settings, 'merge');
  assert.equal(result.changed, true);
  assert.equal(body.safetySettings.length, 2);
  assert.equal(body.safetySettings.find((entry) => entry.category === 'HARM_CATEGORY_HARASSMENT').threshold, 'BLOCK_NONE');
});

test('insert-only keeps a body that already carries safetySettings', () => {
  const body = { safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }] };
  const before = JSON.stringify(body);
  const result = applySafetySettingsToBody(body, [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }], 'insert-only');
  assert.equal(result.changed, false);
  assert.equal(JSON.stringify(body), before);
});

test('replace mode drops unknown existing entries', () => {
  const body = { safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' }] };
  applySafetySettingsToBody(body, [{ category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }], 'replace');
  assert.deepEqual(body.safetySettings, [{ category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }]);
});

test('handles Request input', async () => {
  const { calls, fetch } = captureFetch();
  const patched = createPatchedFetch(fetch, normalizeConfig(undefined), { log() {}, warn() {} });
  const request = new Request(GOOGLE_URL, googleRequest());
  await patched.fetch(request);
  assert.equal(calls.length, 1);
  const forwarded = calls[0].input;
  assert.ok(forwarded instanceof Request);
  const body = JSON.parse(await forwarded.text());
  assert.equal(body.safetySettings.length, 4);
});

test('apply installs the wrapper and its disposer restores the original fetch', async () => {
  const original = globalThis.fetch;
  const { fetch } = captureFetch();
  globalThis.fetch = fetch;
  const ctx = makeContext();
  try {
    apply(ctx, { serverTimeoutSeconds: null });
    assert.notEqual(globalThis.fetch, fetch);
    await globalThis.fetch(GOOGLE_URL, googleRequest());
    assert.equal(ctx.disposers.length, 1);
    ctx.disposers[0]();
    assert.equal(globalThis.fetch, fetch);
  } finally {
    globalThis.fetch = original;
  }
});

test('debugDumpTo records one line per touched request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-parameter-'));
  const dump = join(dir, 'dump.jsonl');
  try {
    const { fetch } = captureFetch();
    const patched = createPatchedFetch(fetch, normalizeConfig({ debugDumpTo: dump }), { log() {}, warn() {} });
    await patched.fetch(GOOGLE_URL, googleRequest());
    const lines = (await readFile(dump, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.injected, true);
    assert.equal(entry.safetySettings.length, 4);
    assert.equal(entry.xServerTimeout, '1200');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('safetySettings: false keeps the body untouched but still adds X-Server-Timeout', async () => {
  const { calls, fetch } = captureFetch();
  const patched = createPatchedFetch(fetch, normalizeConfig({ safetySettings: false, serverTimeoutSeconds: 600 }), { log() {}, warn() {} });
  await patched.fetch(GOOGLE_URL, googleRequest());
  const init = calls[0].init;
  const body = JSON.parse(init.body);
  assert.equal(body.safetySettings, undefined);
  assert.equal(new Headers(init.headers).get('x-server-timeout'), '600');
  assert.equal(patched.stats.injected, 0);
  assert.equal(patched.stats.timeoutHeaders, 1);
});

test('officialParams merges whitelisted fields and keeps unrelated SDK config', async () => {
  const { calls, fetch } = captureFetch();
  const config = normalizeConfig({
    safetySettings: false,
    serverTimeoutSeconds: null,
    officialParams: {
      serviceTier: 'standard',
      cachedContent: 'cachedContents/abc',
      generationConfig: { maxOutputTokens: 131072, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
    },
  });
  const patched = createPatchedFetch(fetch, config, { log() {}, warn() {} });
  await patched.fetch(GOOGLE_URL, googleRequest());
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.serviceTier, 'standard');
  assert.equal(body.cachedContent, 'cachedContents/abc');
  assert.equal(body.generationConfig.maxOutputTokens, 131072);
  assert.equal(body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_HIGH');
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.equal(body.safetySettings, undefined);
  assert.equal(new Headers(calls[0].init.headers).has('x-server-timeout'), false);
  assert.equal(patched.stats.paramsInjected, 1);
});

test('officialParams can enrich a body while safetySettings stay injected', async () => {
  const { calls, fetch } = captureFetch();
  const config = normalizeConfig({ officialParams: { generationConfig: { topP: 0.9 } } });
  const patched = createPatchedFetch(fetch, config, { log() {}, warn() {} });
  await patched.fetch(GOOGLE_URL, googleRequest());
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.safetySettings.length, 4);
  assert.equal(body.generationConfig.topP, 0.9);
  assert.equal(patched.stats.injected, 1);
  assert.equal(patched.stats.paramsInjected, 1);
});

test('normalizeConfig rejects unknown officialParams keys and empty generationConfig', () => {
  assert.throws(() => normalizeConfig({ officialParams: { maxOutputTokens: 1 } }), /unknown `officialParams` key/);
  assert.throws(() => normalizeConfig({ officialParams: { generationConfig: { maxTokens: 1 } } }), /unknown `officialParams.generationConfig` key/);
  assert.throws(() => normalizeConfig({ officialParams: { generationConfig: {} } }), /generationConfig/);
  assert.throws(() => normalizeConfig({ officialParams: [] }), /officialParams/);
  assert.deepEqual(normalizeConfig(undefined).officialParams, {});
});
