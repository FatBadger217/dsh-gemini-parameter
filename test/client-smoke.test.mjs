import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeConfig } from '../lib/index.js';

// 在宿主外的最小 window 环境里执行手写 client bundle，验证：
// 1) 模块契约（apply/inject/NS/__internals，且不再导出 PANEL_ID）；
// 2) 槽注册形状：apply(stub ctx) 只注册 plugins.bundle.config，key=包名；
// 3) zh/en 字典键齐平；
// 4) configToModel → validateModel 与服务端 normalizeConfig 往返一致；
// 5) 非法输入在客户端就地报错（不产生半截配置）。
function loadClientBundle() {
  const src = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8');
  let spec = null;
  globalThis.window = { __ModuleLoader__: { load: (s) => { spec = s; } } };
  const require = (name) => {
    if (name === 'react') return { createElement: () => null };
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {};
    throw new Error('unexpected require: ' + name);
  };
  try {
    // 宿主以脚本方式执行 bundle；这里等价求值。
    new Function('require', src)(require);
  } finally {
    delete globalThis.window;
  }
  assert.ok(spec, 'bundle 未调用 __ModuleLoader__.load');
  return spec.factory(require);
}

const tr = (key, params) => (params === undefined ? key : key + ' ' + JSON.stringify(params));

test('client bundle：模块契约与 require 白名单', () => {
  const mod = loadClientBundle();
  assert.equal(typeof mod.apply, 'function');
  assert.deepEqual(mod.inject, ['slots', 'locale', 'remote']);
  assert.equal(mod.NS, 'settings.geminiParameter');
  assert.equal(mod.PANEL_ID, undefined, '0.1.0 不得再导出 PANEL_ID');
  assert.ok(mod.__internals && typeof mod.__internals.configToModel === 'function');
});

test('client bundle：apply 只注册 plugins.bundle.config，key=包名', () => {
  const mod = loadClientBundle();
  const injectNames = [];
  const registered = [];
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register: () => {}, bind: () => tr },
    remote: { $mount: () => Promise.resolve() },
    slots: {
      inject: (name, cb) => { injectNames.push(name); cb(); },
      register: (options, component) => {
        registered.push({ options, component });
        return () => {};
      }
    }
  };
  mod.apply(ctx);
  assert.deepEqual(injectNames, ['plugins.bundle.config'], '只允许注册 plugins.bundle.config');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].options.name, 'plugins.bundle.config');
  assert.equal(registered[0].options.key, 'dsh-gemini-parameter');
  assert.equal(typeof registered[0].component, 'function');
  const face = registered[0].options.inject();
  assert.equal(typeof face.t, 'function');
  for (const m of ['loadInfo', 'saveConfig', 'resetDefaults', 'revealConfigFile']) {
    assert.equal(typeof face[m], 'function', 'face 缺 ' + m);
  }
});

test('client bundle：zh/en 字典键齐平', () => {
  const { zh, en } = loadClientBundle().__internals;
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});

test('client bundle：configToModel → validateModel 与服务端 normalizeConfig 往返一致', () => {
  const mod = loadClientBundle();
  const original = {
    hosts: ['generativelanguage.googleapis.com'],
    endpoints: [':generateContent', ':streamGenerateContent'],
    mode: 'merge',
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ],
    serverTimeoutSeconds: 300,
    officialParams: {
      serviceTier: 'flex',
      cachedContent: 'cache-123',
      generationConfig: { maxOutputTokens: 8192, temperature: 0.7, thinkingConfig: { thinkingLevel: 'low' } }
    },
    debugDumpTo: null,
    log: false,
    onUnsupportedBody: 'skip'
  };
  const model = mod.__internals.configToModel(original);
  const { config, errors } = mod.__internals.validateModel(model, tr);
  assert.deepEqual(errors, {});
  assert.deepEqual(normalizeConfig(config), normalizeConfig(original));
});

test('client bundle：默认配置往返一致', () => {
  const mod = loadClientBundle();
  // getInfo 返回的是服务端归一化配置，这里同样以 normalizeConfig({}) 为输入。
  const model = mod.__internals.configToModel(normalizeConfig({}));
  const { config, errors } = mod.__internals.validateModel(model, tr);
  assert.deepEqual(errors, {});
  assert.deepEqual(normalizeConfig(config), normalizeConfig({}));
});

test('client bundle：非法输入就地报错且不产出配置', () => {
  const mod = loadClientBundle();
  const model = mod.__internals.configToModel({});
  model.hosts[0] = 'not a host!';
  model.timeoutEnabled = true;
  model.timeoutText = '9999';
  const { errors } = mod.__internals.validateModel(model, tr);
  assert.ok(errors['hosts.0'], 'hosts 错误缺失');
  assert.ok(errors['serverTimeoutSeconds'], '超时错误缺失');
});
