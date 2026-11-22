/**
 * config-file.test.mjs — cordis.patch.yml config 段读写器单测（本地临时目录，不碰正式包）。
 * 运行：node --test test/config-file.test.mjs（Windows 上不要用 `node --test test/`）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deepEqual,
  emitConfigBlock,
  locateConfigBlock,
  readPluginConfig,
  writePluginConfig
} from '../lib/config-file.js';

/** 与随包发布的手写 cordis.patch.yml 同构的样本（含块内整行注释）。 */
const HAND_WRITTEN = `# dsh-gemini-parameter bundle patch.
# 头部注释必须原样保留。
- insert:
    - id: gemini-parameter
      name: dsh-gemini-parameter
      config:
        # Exact hostnames (a leading "*.") wildcard is allowed).
        hosts:
          - generativelanguage.googleapis.com
        # Path suffixes.
        endpoints:
          - ":generateContent"
          - ":streamGenerateContent"
        mode: merge
        safetySettings:
          - category: HARM_CATEGORY_HARASSMENT
            threshold: BLOCK_NONE
          - category: HATE_SPEECH_X
            threshold: BLOCK_LOW_AND_ABOVE
        # 只想透传其它官方参数时改成 false。
        serverTimeoutSeconds: 1200
        officialParams: {}
        debugDumpTo: null
        log: false
    - id: another-plugin
      name: something-else
      config:
        key: value
`;

const DEFAULTS = {
  hosts: ['generativelanguage.googleapis.com'],
  endpoints: [':generateContent', ':streamGenerateContent'],
  mode: 'merge',
  safetySettings: [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
  ],
  serverTimeoutSeconds: 1200,
  officialParams: {},
  debugDumpTo: null,
  log: false,
  onUnsupportedBody: 'skip'
};

async function tempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-parameter-cfg-'));
  const file = join(dir, 'cordis.patch.yml');
  const backupDir = join(dir, '.config-backups');
  await writeFile(file, HAND_WRITTEN, 'utf8');
  return { dir, file, backupDir };
}

test('解析随包手写形式：注释穿插、引号标量、块序列映射', async () => {
  const { dir, file } = await tempWorkspace();
  try {
    const { config, meta } = await readPluginConfig(file);
    assert.deepEqual(config.hosts, ['generativelanguage.googleapis.com']);
    assert.deepEqual(config.endpoints, [':generateContent', ':streamGenerateContent']);
    assert.equal(config.mode, 'merge');
    assert.deepEqual(config.safetySettings, [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HATE_SPEECH_X', threshold: 'BLOCK_LOW_AND_ABOVE' }
    ]);
    assert.equal(config.serverTimeoutSeconds, 1200);
    assert.deepEqual(config.officialParams, {});
    assert.equal(config.debugDumpTo, null);
    assert.equal(config.log, false);
    // 块边界：必须停在 another-plugin 行之前。
    const boundary = meta.lines.slice(meta.blockEnd - 1, meta.blockEnd + 1).join('|');
    assert.ok(boundary.includes('another-plugin'), '块尾应停在下一插件行: ' + boundary);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('定位失败报 ROW_NOT_FOUND / CONFIG_KEY_NOT_FOUND', () => {
  assert.throws(() => locateConfigBlock('- insert:\n    - id: nope\n', 'gemini-parameter'), /ROW_NOT_FOUND/);
  assert.throws(() => locateConfigBlock('- insert:\n    - id: gemini-parameter\n      name: x\n', 'gemini-parameter'), /CONFIG_KEY_NOT_FOUND/);
});

test('写入：替换 config 子块、保留块外注释与后续行、产生时间戳备份', async () => {
  const { dir, file, backupDir } = await tempWorkspace();
  try {
    const result = await writePluginConfig(file, DEFAULTS, { backupDir, now: new Date('2026-11-22T00:00:00') });
    assert.equal(result.configFile, file);
    assert.match(result.backupFile, /cordis\.patch\.yml\.20261122-000000\.yml$/);
    const after = await readFile(file, 'utf8');
    // 头部注释保留。
    assert.match(after, /^# dsh-gemini-parameter bundle patch\./m);
    // 后续插件行保留。
    assert.match(after, /- id: another-plugin/);
    // 规范输出：所有字符串标量带双引号。
    assert.match(after, /- "generativelanguage\.googleapis\.com"/);
    assert.match(after, /mode: "merge"/);
    // 临时文件已清理。
    const leftover = (await readdir(dir)).filter((name) => name.includes('.tmp-'));
    assert.deepEqual(leftover, []);
    // 备份内容 = 写入前的原文。
    const backupText = await readFile(result.backupFile, 'utf8');
    assert.equal(backupText, HAND_WRITTEN);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('写入后回读等于写入值（默认配置与复杂 officialParams）', async () => {
  const { dir, file, backupDir } = await tempWorkspace();
  try {
    const complex = {
      ...DEFAULTS,
      safetySettings: false,
      serverTimeoutSeconds: null,
      officialParams: {
        serviceTier: 'flex',
        generationConfig: {
          maxOutputTokens: 131072,
          mediaResolution: 'low',
          stopSequences: ['END', 'STOP'],
          responseSchema: { type: 'object', properties: { answer: { type: 'string' } } }
        }
      },
      debugDumpTo: 'C:\\Temp\\dump.jsonl'
    };
    await writePluginConfig(file, complex, { backupDir });
    const { config } = await readPluginConfig(file);
    assert.deepEqual(config, complex);
    // 再写回一次（幂等文本也应稳定）。
    await writePluginConfig(file, complex, { backupDir });
    const again = await readPluginConfig(file);
    assert.deepEqual(again.config, complex);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify 拒绝时不写文件、不产生备份', async () => {
  const { dir, file, backupDir } = await tempWorkspace();
  try {
    const before = await readFile(file, 'utf8');
    await assert.rejects(
      () => writePluginConfig(file, DEFAULTS, { backupDir, verify: () => ({ ok: false, message: 'boom' }) }),
      /VERIFY_FAILED/
    );
    assert.equal(await readFile(file, 'utf8'), before);
    let backupEntries = [];
    try { backupEntries = await readdir(backupDir); } catch { /* 目录可以不存在 */ }
    assert.deepEqual(backupEntries, []);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('制表符缩进直接报错', async () => {
  const { dir, file } = await tempWorkspace();
  try {
    await writeFile(file, '- insert:\n    - id: gemini-parameter\n      config:\n        hosts:\n        \t- x\n', 'utf8');
    await assert.rejects(() => readPluginConfig(file), (error) => error.code === 'TABS_FORBIDDEN');
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('emitConfigBlock 对 safetySettings 的三种形态', () => {
  const asFalse = emitConfigBlock({ ...DEFAULTS, safetySettings: false }, 8).join('\n');
  assert.match(asFalse, /safetySettings: false/);
  const asMap = emitConfigBlock({ ...DEFAULTS, safetySettings: { HARM_CATEGORY_HARASSMENT: 'OFF' } }, 8).join('\n');
  assert.match(asMap, /"HARM_CATEGORY_HARASSMENT": "OFF"/);
  const asArray = emitConfigBlock(DEFAULTS, 8).join('\n');
  assert.match(asArray, /- category: "HARM_CATEGORY_HARASSMENT"/);
});

test('deepEqual 忽略键序', () => {
  assert.ok(deepEqual({ a: 1, b: [2, { c: 3 }] }, { b: [2, { c: 3 }], a: 1 }));
  assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
});

test('读取随包 cordis.patch.yml（冒烟）', async () => {
  const { config } = await readPluginConfig(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)));
  assert.equal(config.mode, 'merge');
  assert.equal(config.serverTimeoutSeconds, 1200);
});
