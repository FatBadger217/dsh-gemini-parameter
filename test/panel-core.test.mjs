/**
 * panel-core.test.mjs — 配置面板宿主侧逻辑单测（临时目录 + 桩 reveal，不联网、
 * 不需要 typert）。运行：node --test test/panel-core.test.mjs。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeConfig } from '../lib/index.js';
import { resolveTypertRemoteService } from '../lib/panel-service.js';
import {
  DEFAULT_PANEL_CONFIG,
  buildPanelContribution,
  buildPanelManifest,
  createPanelMethods
} from '../lib/panel-core.js';

const ROW = `- insert:
    - id: gemini-parameter
      name: dsh-gemini-parameter
      config:
        mode: merge
        serverTimeoutSeconds: 1200
        officialParams: {}
`;

async function tempPanel(overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-parameter-panel-'));
  const configFile = join(dir, 'cordis.patch.yml');
  const backupDir = join(dir, '.config-backups');
  await writeFile(configFile, ROW, 'utf8');
  const activeConfig = normalizeConfig({ mode: 'merge', serverTimeoutSeconds: 1200, officialParams: {} });
  const stats = { matched: 3, injected: 2, paramsInjected: 1, timeoutHeaders: 2, unsupported: 0, failed: 0 };
  const methods = createPanelMethods({
    configFile,
    backupDir,
    activeConfig,
    stats,
    version: '0.1.0-test',
    packageName: 'dsh-gemini-parameter',
    // bootTime 取「未来」：模拟宿主在配置文件最后修改之后才启动
    // （临时文件是刚写的，mtime=now；真实场景里 mtime 早于启动）。
    bootTime: Date.now() + 60_000,
    reveal: overrides.reveal ?? (async () => ({ ok: true, path: 'stub' })),
    ...overrides.deps
  });
  return { dir, methods, configFile, backupDir, stats };
}

test('getInfo：初始一致 → needsRestart=false，stats 快照、路径齐全', async () => {
  const { dir, methods } = await tempPanel();
  try {
    const info = await methods.getInfo();
    assert.equal(info.version, '0.1.0-test');
    assert.equal(info.fileExists, true);
    assert.equal(info.readError, null);
    assert.equal(info.needsRestart, false);
    assert.equal(info.differsFromActive, false);
    assert.deepEqual(info.stats.matched, 3);
    assert.ok(info.configFile.endsWith('cordis.patch.yml'));
    assert.equal(info.activeConfig.mode, 'merge');
    assert.equal(info.fileConfig.mode, 'merge');
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getInfo：读文件抛错 → readError 带错误文案（客户端契约字段）', async () => {
  const { dir, methods } = await tempPanel({ deps: { read: async () => { const e = new Error('boom EACCES'); throw e; } } });
  try {
    const info = await methods.getInfo();
    assert.equal(info.fileExists, true);
    assert.ok(String(info.readError).includes('boom EACCES'), 'readError 应包含错误信息');
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveConfig：非法 officialParams 抛 INVALID_CONFIG，文件不动', async () => {
  const { dir, methods, configFile } = await tempPanel();
  try {
    await assert.rejects(
      () => methods.saveConfig({ officialParams: { generationConfig: { nope: 1 } } }),
      (error) => error.code === 'INVALID_CONFIG'
    );
    assert.equal(await readFile(configFile, 'utf8'), ROW);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveConfig：合法配置写入 + 备份；getInfo 随即报告需要重启', async () => {
  const { dir, methods } = await tempPanel();
  try {
    const saved = await methods.saveConfig({
      mode: 'insert-only',
      serverTimeoutSeconds: 200,
      officialParams: { generationConfig: { maxOutputTokens: 131072 }, serviceTier: 'standard' }
    });
    assert.ok(saved.backupFile);
    assert.equal(saved.needsRestart, true);
    const info = await methods.getInfo();
    assert.equal(info.needsRestart, true);
    assert.equal(info.differsFromActive, true);
    assert.equal(info.fileConfig.serverTimeoutSeconds, 200);
    assert.equal(info.fileConfig.mode, 'insert-only');
    assert.deepEqual(info.fileConfig.officialParams.generationConfig, { maxOutputTokens: 131072 });
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resetDefaults：写回显式默认集且 getInfo 一致', async () => {
  const { dir, methods } = await tempPanel();
  try {
    await methods.saveConfig({ safetySettings: false, serverTimeoutSeconds: null });
    const reset = await methods.resetDefaults();
    assert.equal(reset.resetToDefaults, true);
    const info = await methods.getInfo();
    assert.equal(info.fileConfig.safetySettings === null, false);
    assert.equal(info.fileConfig.safetySettings.length, 4);
    assert.equal(info.fileConfig.serverTimeoutSeconds, 1200);
    assert.deepEqual(info.fileConfig.officialParams, {});
    const normalizedDefaults = normalizeConfig(JSON.parse(JSON.stringify(DEFAULT_PANEL_CONFIG)));
    assert.deepEqual(info.fileConfig, normalizedDefaults);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('revealConfigFile：成功与失败路径', async () => {
  const ok = await tempPanel();
  try {
    const result = await ok.methods.revealConfigFile();
    assert.equal(result.path, 'stub');
  }
  finally {
    await rm(ok.dir, { recursive: true, force: true });
  }
  const bad = await tempPanel({ reveal: async () => ({ ok: false, error: 'no explorer' }) });
  try {
    await assert.rejects(() => bad.methods.revealConfigFile(), (error) => error.code === 'REVEAL_FAILED');
  }
  finally {
    await rm(bad.dir, { recursive: true, force: true });
  }
});

test('resolveTypertRemoteService：本地（无 typert）不抛错、返回 null 或构造函数', async () => {
  const result = await resolveTypertRemoteService();
  assert.ok(result === null || typeof result === 'function');
});

test('manifest / contribution 描述符：四方法、恒等 codec、id 形如 pkg#service/method', () => {
  for (const descriptors of [buildPanelManifest('dsh-gemini-parameter').invocations, buildPanelContribution('dsh-gemini-parameter').descriptors]) {
    assert.equal(descriptors.length, 4);
    for (const item of descriptors) {
      assert.equal(item.service, 'geminiParameterPanel');
      assert.equal(item.namespace, 'geminiParameterPanel');
      assert.equal(item.invocation.kind, 'direct');
      assert.match(item.id, /^dsh-gemini-parameter#geminiParameterPanel\/\w+$/);
      const parsed = { any: ['value', 1, null] };
      assert.deepEqual(item.result.create().parse(parsed), parsed);
    }
  }
  const manifest = buildPanelManifest('dsh-gemini-parameter');
  assert.equal(manifest.face, 'host');
  const save = manifest.invocations.find((item) => item.method === 'saveConfig');
  assert.equal(save.parameters.length, 1);
  assert.equal(save.parameters[0].name, 'config');
});

test('getInfo：配置文件缺失 → fileExists=false 而不是抛错', async () => {
  const { dir, methods, configFile } = await tempPanel();
  try {
    await rm(configFile);
    const info = await methods.getInfo();
    assert.equal(info.fileExists, false);
    assert.equal(info.fileConfig, null);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});
