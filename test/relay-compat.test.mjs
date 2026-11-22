/**
 * relay-compat.test.mjs — relayUnwrap（billion-context 等代理改写兼容）单测。
 * 场景：宿主链上的代理插件把模型请求 URL 改写成 <loopback>/bili/<原始URL>，
 * 开启 relayUnwrap 后应解出原始 URL 匹配并照常注入；未开启时只计数不注入。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatchedFetch, normalizeConfig } from '../lib/index.js';

const RELAY_URL = 'http://127.0.0.1:18787/bili/https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:streamGenerateContent?alt=sse';

function captureFetch() {
  const calls = [];
  const fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response('{}', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { calls, fetch };
}

function request(body = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] })) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  };
}

test('normalizeConfig：relayUnwrap 默认关闭，字符串/数组均可，非法项报错', () => {
  assert.deepEqual(normalizeConfig({}).relayUnwrap, []);
  assert.deepEqual(normalizeConfig({ relayUnwrap: '/bili/' }).relayUnwrap, ['/bili/']);
  assert.deepEqual(normalizeConfig({ relayUnwrap: ['/bili/', '/relay/'] }).relayUnwrap, ['/bili/', '/relay/']);
  assert.throws(() => normalizeConfig({ relayUnwrap: ['bili/'] }), /relayUnwrap/);
  assert.throws(() => normalizeConfig({ relayUnwrap: ['/'] }), /relayUnwrap/);
});

test('relayUnwrap 开启：本地代理 URL 解出原始网址，照常注入安全阈值与超时头', async () => {
  const { calls, fetch } = captureFetch();
  const config = normalizeConfig({ relayUnwrap: ['/bili/'], serverTimeoutSeconds: 900 });
  const patched = createPatchedFetch(fetch, config, { log() {}, warn() {} });
  await patched.fetch(RELAY_URL, request());
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.safetySettings.length, 4);
  assert.equal(body.safetySettings.every((entry) => entry.threshold === 'BLOCK_NONE'), true);
  assert.equal(new Headers(calls[0].init.headers).get('x-server-timeout'), '900');
  assert.equal(patched.stats.matched, 1);
  assert.equal(patched.stats.injected, 1);
  assert.equal(patched.stats.relaySpotted, 0);
});

test('relayUnwrap 未开启：本地代理 URL 原样放行，relaySpotted 计数', async () => {
  const { calls, fetch } = captureFetch();
  const config = normalizeConfig({});
  const patched = createPatchedFetch(fetch, config, { log() {}, warn() {} });
  const init = request();
  await patched.fetch(RELAY_URL, init);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init, init, '未被触碰，原 init 引用透传');
  assert.equal(patched.stats.matched, 0);
  assert.equal(patched.stats.relaySpotted, 1);
});

test('relayUnwrap 开启但内嵌主机不在白名单：不注入也不误报', async () => {
  const { calls, fetch } = captureFetch();
  const config = normalizeConfig({ relayUnwrap: ['/bili/'] });
  const patched = createPatchedFetch(fetch, config, { log() {}, warn() {} });
  const init = request(JSON.stringify({ model: 'x', messages: [] }));
  await patched.fetch('http://127.0.0.1:18787/bili/https://api.openai.com/v1/chat/completions', init);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init, init);
  assert.equal(patched.stats.matched, 0);
  assert.equal(patched.stats.relaySpotted, 0, '兼容已开启，不告警');
});

test('relayUnwrap 开启但内嵌端点不匹配（:countTokens）：原样放行', async () => {
  const { calls, fetch } = captureFetch();
  const config = normalizeConfig({ relayUnwrap: ['/bili/'] });
  const patched = createPatchedFetch(fetch, config, { log() {}, warn() {} });
  const init = request();
  await patched.fetch('http://127.0.0.1:18787/bili/https://generativelanguage.googleapis.com/v1beta/models/x:countTokens', init);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init, init);
  assert.equal(patched.stats.matched, 0);
});

test('relay URL 的内嵌查询串不破坏端点后缀匹配', async () => {
  const { calls, fetch } = captureFetch();
  const config = normalizeConfig({ relayUnwrap: ['/bili/'], safetySettings: false, serverTimeoutSeconds: null });
  const patched = createPatchedFetch(fetch, config, { log() {}, warn() {} });
  await patched.fetch('http://127.0.0.1:18787/bili/https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:streamGenerateContent?alt=sse', request());
  assert.equal(patched.stats.matched, 1, '查询串归位后仍按 :streamGenerateContent 命中');
});
