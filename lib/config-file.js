/**
 * config-file.js — 插件自身 cordis.patch.yml 的 config 段读写器（零依赖）。
 *
 * 为什么不用 yaml 库：本插件保持零运行时依赖（见 README / 维护文档），而我们需要
 * 读写的只是自己包内 cordis.patch.yml 里、固定形状的那一段 `config:` 块。这里实现
 * 一个受控的 YAML 子集：
 *
 *   读（必须同时兼容两种来源）：
 *     - 随包发布的手写形式（块映射、块序列、引号标量、行内注释不存在、
 *       整行注释存在、`{}` 空流映射）；
 *     - 本文件的规范输出（所有字符串标量一律 JSON 双引号；复合值一行 JSON 流）。
 *   写：外科手术式替换 —— 只重写本插件行 `config:` 之下的子块，保留文件中其它
 *     所有行与整行注释（块内的注释由规范输出重建）。
 *
 * 安全性：
 *   - 写入走「时间戳备份 → 临时文件 → 回读校验 → 原子 rename」；校验失败自动
 *     删除临时文件并抛错，原文件不动；
 *   - 解析器只认识上述子集，遇到制表符、空映射键、坏流式值等直接报带行号的错，
 *     绝不猜语义。
 */

import { mkdir, copyFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/* ───────────────────────── 小工具 ───────────────────────── */

function fail(code, message) {
    const error = new Error("[" + code + "] " + message);
    error.code = code;
    return error;
}

/** 递归按键名排序后的稳定 JSON 串（用于深比较，不关心键序差异）。 */
export function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return "[" + value.map(stableStringify).join(",") + "]";
    const keys = Object.keys(value).sort();
    return "{" + keys.map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

export function deepEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
}

/** 深拷贝（配置值必须是 JSON 可序列化的，normalizeConfig 也这么要求）。 */
export function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/* ───────────────────────── YAML 子集：解析 ───────────────────────── */

/**
 * 把「行数组」变成「有内容的行」：去掉整行注释与空行，记录缩进。
 * 禁止制表符缩进（手写 YAML 最常见的坑，直接报行号）。
 */
function significantFromLines(raw) {
    const rows = [];
    for (let index = 0; index < raw.length; index++) {
        const line = raw[index];
        if (line.includes("\t"))
            throw fail("TABS_FORBIDDEN", "第 " + (index + 1) + " 行含有制表符缩进，YAML 只允许空格");
        const trimmedEnd = line.replace(/\s+$/, "");
        if (trimmedEnd === "")
            continue;
        const indent = trimmedEnd.length - trimmedEnd.replace(/^ +/, "").length;
        const content = trimmedEnd.slice(indent);
        if (content.startsWith("#"))
            continue;
        rows.push({ indent, text: content, line: index + 1 });
    }
    return rows;
}

/** 文本版入口。 */
function toSignificantLines(text) {
    return significantFromLines(text.split(/\r?\n/));
}

/** 标量解析：JSON 双引号串 / null / 布尔 / 整数 / 裸字符串。 */
function parseScalar(raw) {
    const text = raw.trim();
    if (text.startsWith('"') && text.endsWith('"')) {
        try {
            return JSON.parse(text);
        }
        catch {
            throw fail("PARSE_ERROR", "第 ? 行的双引号标量不是合法 JSON 字符串: " + text);
        }
    }
    if (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
        return text.slice(1, -1).replace(/''/g, "'");
    if (text === "null" || text === "~" || text === "Null" || text === "NULL")
        return null;
    if (text === "true" || text === "True")
        return true;
    if (text === "false" || text === "False")
        return false;
    if (/^-?\d+$/.test(text))
        return Number(text);
    return text;
}

/** 行内值：空、流式（{ 或 [ 开头，按 JSON 解析）、或普通标量。 */
function parseInlineValue(raw) {
    const text = raw.trim();
    if (text === "")
        return { empty: true };
    if (text.startsWith("{") || text.startsWith("[")) {
        try {
            return { value: JSON.parse(text) };
        }
        catch {
            throw fail("PARSE_ERROR", "流式值不是合法 JSON（本实现只支持单行流式）: " + text.slice(0, 60));
        }
    }
    return { value: parseScalar(text) };
}

/** 把 "key: rest" 拆开；key 本身按裸标识符处理（我们的键都是 ASCII 标识符）。 */
function splitKey(text, line) {
    const match = /^(?:"([^"]+)"|'([^']+)'|([^\s:]+))\s*:(?:\s+(.*))?$/.exec(text);
    if (!match)
        throw fail("PARSE_ERROR", "第 " + line + " 行无法按 “键: 值” 解析: " + text.slice(0, 60));
    return { key: match[1] ?? match[2] ?? match[3], rest: (match[4] ?? "").trim() };
}

const EMPTY = Symbol("empty");

/** 解析从 rows[from] 开始、基缩进为 parentIndent 的一个节点（映射 / 序列 / 空）。 */
function parseNode(rows, from, parentIndent) {
    if (from >= rows.length || rows[from].indent <= parentIndent)
        return { value: EMPTY, next: from };
    const base = rows[from].indent;
    const isItem = (row) => row.indent === base && (row.text === "-" || row.text.startsWith("- "));
    if (isItem(rows[from]))
        return parseListNode(rows, from, base, isItem);
    return parseMapNode(rows, from, base, isItem);
}

function parseMapNode(rows, from, base, isItem) {
    const value = {};
    let i = from;
    while (i < rows.length && rows[i].indent === base && !isItem(rows[i])) {
        const row = rows[i];
        const { key, rest } = splitKey(row.text, row.line);
        if (Object.hasOwn(value, key))
            throw fail("PARSE_ERROR", "第 " + row.line + " 行出现重复键: " + key);
        if (rest === "") {
            const child = parseNode(rows, i + 1, base);
            if (child.value === EMPTY) {
                value[key] = null;
                i = child.next;
            }
            else {
                value[key] = child.value;
                i = child.next;
            }
        }
        else {
            const inline = parseInlineValue(rest);
            if (inline.empty)
                throw fail("PARSE_ERROR", "第 " + row.line + " 行 “" + key + ":” 后面有无法解析的内容");
            value[key] = inline.value;
            i++;
        }
    }
    if (i === from)
        throw fail("PARSE_ERROR", "第 " + rows[from].line + " 行开始处既不是映射也不是序列");
    return { value, next: i };
}

function parseListNode(rows, from, base, isItem) {
    const value = [];
    let i = from;
    while (i < rows.length && isItem(rows[i])) {
        const row = rows[i];
        const content = row.text === "-" ? "" : row.text.slice(2).trim();
        if (content === "") {
            const child = parseNode(rows, i + 1, base);
            if (child.value === EMPTY)
                throw fail("PARSE_ERROR", "第 " + row.line + " 行的 “-” 后面缺少内容");
            value.push(child.value);
            i = child.next;
            continue;
        }
        // 序列元素：要么是标量/流式，要么是 “- key: value” 起头的映射项。
        const looksLikePair = !content.startsWith('"') && !content.startsWith("'") && /^[^\s:]+(\s*:(\s|$))/.test(content);
        if (!looksLikePair) {
            const inline = parseInlineValue(content);
            if (inline.empty)
                throw fail("PARSE_ERROR", "第 " + row.line + " 行的序列元素无法解析");
            value.push(inline.value);
            i++;
            continue;
        }
        const itemIndent = row.indent + 2; // "category" 的列
        const { key, rest } = splitKey(content, row.line);
        const item = {};
        if (rest === "") {
            const child = parseNode(rows, i + 1, itemIndent);
            if (child.value === EMPTY)
                item[key] = null;
            else
                item[key] = child.value;
            i = child.next;
        }
        else {
            const inline = parseInlineValue(rest);
            if (inline.empty)
                throw fail("PARSE_ERROR", "第 " + row.line + " 行 “- " + key + ":” 后面缺少值");
            item[key] = inline.value;
            i++;
        }
        while (i < rows.length && rows[i].indent === itemIndent && !(rows[i].text === "-" || rows[i].text.startsWith("- "))) {
            const sibling = rows[i];
            const pair = splitKey(sibling.text, sibling.line);
            if (Object.hasOwn(item, pair.key))
                throw fail("PARSE_ERROR", "第 " + sibling.line + " 行序列元素内出现重复键: " + pair.key);
            if (pair.rest === "") {
                const child = parseNode(rows, i + 1, itemIndent);
                if (child.value === EMPTY)
                    item[pair.key] = null;
                else
                    item[pair.key] = child.value;
                i = child.next;
            }
            else {
                const inline = parseInlineValue(pair.rest);
                if (inline.empty)
                    throw fail("PARSE_ERROR", "第 " + sibling.line + " 行 “" + pair.key + ":” 后面有无法解析的内容");
                item[pair.key] = inline.value;
                i++;
            }
        }
        value.push(item);
    }
    return { value, next: i };
}

/* ───────────────────────── 定位插件行的 config 块 ───────────────────────── */

/**
 * 在整份 patch 文本里找到 `- id: gemini-parameter`（或指定 id）那一行的
 * `config:` 子块范围。
 *
 * 返回（1 基行号，含端点）：
 *   rowIdLine   —— `- id: <id>` 行
 *   configLine  —— `config:` 行
 *   blockStart  —— config 子块第一个属性行（= configLine + 1）
 *   blockEnd    —— 子块之后第一行「非空非注释」的原文行号（独占端点；可能是
 *                  lines.length + 1，表示到文件尾）
 */
export function locateConfigBlock(text, pluginId = "gemini-parameter") {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        const idMatch = new RegExp("^(\\s*)-\\s*id:\\s*" + pluginId + "\\s*$").exec(lines[index]);
        if (!idMatch)
            continue;
        const rowIndent = idMatch[1].length;
        // 同一行的 list 缩进：属性行应比 "- id:" 再深 2 格。
        let configLine = -1;
        let cursor = index + 1;
        while (cursor < lines.length) {
            const t = lines[cursor].replace(/\s+$/, "");
            if (t === "" || t.trimStart().startsWith("#")) {
                cursor++;
                continue;
            }
            const ind = t.length - t.replace(/^ +/, "").length;
            if (ind <= rowIndent)
                break; // 行结束
            const configMatch = /^config:(\s+(.*))?$/.exec(t.trim());
            if (configMatch) {
                configLine = cursor;
                break;
            }
            cursor++;
        }
        if (configLine < 0)
            throw fail("CONFIG_KEY_NOT_FOUND", "找到插件行（第 " + (index + 1) + " 行）但缺少 config: 子块");
        const configIndent = lines[configLine].length - lines[configLine].replace(/^ +/, "").length;
        // 块内属性行可以穿插整行注释与空行（随包手写文件即如此）：块尾 =
        // 最后一个「更深缩进的有内容行」之后。中间与末尾的注释行若缩进更深会被
        // 一并归入替换范围（规范输出自带注释，这是期望行为）。
        let end = configLine + 1;
        let lastDeep = configLine;
        while (end < lines.length) {
            const t = lines[end].replace(/\s+$/, "");
            if (t !== "" && !t.trimStart().startsWith("#")) {
                const ind = t.length - t.replace(/^ +/, "").length;
                if (ind > configIndent)
                    lastDeep = end;
                else
                    break;
            }
            end++;
        }
        return { rowIdLine: index + 1, configLine: configLine + 1, blockStart: configLine + 2, blockEnd: lastDeep + 2, lines };
    }
    throw fail("ROW_NOT_FOUND", "patch 文件里没有找到 id 为 " + pluginId + " 的插件行");
}

/**
 * 读取并解析插件行 config 段。返回 { config, meta }；文件/结构错误抛带 code 的 Error。
 */
export async function readPluginConfig(filePath, pluginId = "gemini-parameter") {
    let text;
    try {
        text = await readFile(filePath, "utf8");
    }
    catch (error) {
        if (error?.code === "ENOENT")
            throw fail("FILE_NOT_FOUND", "配置文件不存在: " + filePath);
        throw fail("READ_FAILED", "读取配置文件失败: " + (error?.message ?? error));
    }
    const meta = locateConfigBlock(text, pluginId);
    const rows = significantFromLines(linesSlice(meta.lines, meta.blockStart, meta.blockEnd));
    let config = null;
    if (rows.length > 0) {
        const node = parseNode(rows, 0, meta.lines[meta.configLine - 1].length - meta.lines[meta.configLine - 1].replace(/^ +/, "").length - 1);
        config = node.value === EMPTY ? null : node.value;
    }
    let mtimeMs = null;
    try {
        mtimeMs = (await stat(filePath)).mtimeMs;
    }
    catch { /* mtime 只是辅助信息，取不到就算了 */ }
    return { config, meta, mtimeMs };
}

function linesSlice(lines, start /* 1 基含 */, end /* 1 基独占 */) {
    return lines.slice(start - 1, end - 1);
}

/* ───────────────────────── YAML 子集：规范输出 ───────────────────────── */

function quoteScalar(value) {
    if (value === null)
        return "null";
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    return JSON.stringify(String(value));
}

/** 单值行内输出：标量直接行内；数组/对象输出成一行 JSON 流（JSON ⊂ YAML）。 */
function inlineValue(value) {
    if (value === null || typeof value !== "object")
        return quoteScalar(value);
    return JSON.stringify(value);
}

/**
 * 生成 config 子块的规范文本（不含 "config:" 行本身）。
 * baseIndent 是 config: 行的缩进列数（属性行 = baseIndent + 2）。
 * 输出永远带固定注释，保证手工编辑者拿到的文件依旧自解释。
 */
export function emitConfigBlock(config, baseIndent) {
    const pad = " ".repeat(baseIndent);
    const pad2 = " ".repeat(baseIndent + 2);
    const out = [];
    const push = (line) => out.push(line);
    push(pad2 + "# 命中的主机（允许 \"*.\" 前缀通配）。只有发往这些主机的请求会被处理。");
    push(pad2 + "hosts:");
    for (const host of config.hosts)
        push(pad2 + "  - " + quoteScalar(host));
    push(pad2 + "# 携带可注入 JSON body 的路径后缀（\":方法名\"）。");
    push(pad2 + "endpoints:");
    for (const endpoint of config.endpoints)
        push(pad2 + "  - " + quoteScalar(endpoint));
    // relayUnwrap（0.1.1 起）：默认关闭——空列表/缺省时不输出该键，避免污染默认配置
    // （缺键经 normalizeConfig 归一为 []，与显式空列表等价）。
    const relay = Array.isArray(config.relayUnwrap) ? config.relayUnwrap : [];
    if (relay.length > 0) {
        push(pad2 + "# 代理兼容前缀（如 billion-context 的 \"/bili/\"）：路径命中任一前缀时，先解出内嵌的原始 URL 再按 hosts/endpoints 匹配。");
        push(pad2 + "relayUnwrap:");
        for (const prefix of relay)
            push(pad2 + "  - " + quoteScalar(prefix));
    }
    push(pad2 + "# merge=保留请求已带类别并覆盖阈值 / replace=整表替换 / insert-only=仅在请求完全没带 safetySettings 时注入。");
    push(pad2 + "mode: " + quoteScalar(config.mode));
    push(pad2 + "# false=不注入（保持 Google 默认高限制）；否则为数组 [{category, threshold}]。");
    if (config.safetySettings === null || config.safetySettings === false) {
        push(pad2 + "safetySettings: false");
    }
    else if (Array.isArray(config.safetySettings)) {
        push(pad2 + "safetySettings:");
        for (const item of config.safetySettings) {
            push(pad2 + "  - category: " + quoteScalar(item.category));
            push(pad2 + "    threshold: " + quoteScalar(item.threshold));
        }
    }
    else {
        push(pad2 + "safetySettings:");
        for (const [category, threshold] of Object.entries(config.safetySettings))
            push(pad2 + "  " + quoteScalar(category) + ": " + quoteScalar(threshold));
    }
    push(pad2 + "# X-Server-Timeout 头（秒），1..1200；null（或 0）= 不发送该头。");
    push(pad2 + "serverTimeoutSeconds: " + inlineValue(config.serverTimeoutSeconds));
    push(pad2 + "# 额外的 Google 官方参数（白名单校验，未知键挂载时报错）。");
    const params = config.officialParams ?? {};
    const keys = Object.keys(params);
    if (keys.length === 0) {
        push(pad2 + "officialParams: {}");
    }
    else {
        push(pad2 + "officialParams:");
        for (const key of keys) {
            const value = params[key];
            if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
                push(pad2 + "  " + key + ":");
                for (const sub of Object.keys(value))
                    push(pad2 + "    " + sub + ": " + inlineValue(value[sub]));
            }
            else {
                push(pad2 + "  " + key + ": " + inlineValue(value));
            }
        }
    }
    push(pad2 + "# 调试转储：每个命中请求写一行 JSONL（不含 prompt 内容）。null=关闭。");
    push(pad2 + "debugDumpTo: " + inlineValue(config.debugDumpTo ?? null));
    push(pad2 + "# true=每个注入请求打一行宿主日志。");
    push(pad2 + "log: " + quoteScalar(config.log === true));
    push(pad2 + "# skip=放行无法注入的请求体 / error=对它们抛 GeminiParameterError。");
    push(pad2 + "onUnsupportedBody: " + quoteScalar(config.onUnsupportedBody ?? "skip"));
    return out;
}

/* ───────────────────────── 写回（备份 + 原子替换 + 回读校验） ───────────────────────── */

function timestamp(now) {
    const d = now ?? new Date();
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/**
 * 把 value 写回 filePath 中插件行的 config 子块。
 *
 * 步骤：读原文 → 定位子块 → 生成规范文本 → 整文件重建 → 写临时文件 →
 *       回读临时文件解析 + verify(parsed) 校验 → 备份原文件 → rename 覆盖。
 * 任何一步失败都不触碰原文件（备份发生在校验通过之后、覆盖之前）。
 *
 * verify: (parsed) => { ok: true, value: 归一化后的配置 } | { ok: false, message }
 * 返回 { configFile, backupFile, applied }（applied = verify 归一化后的值）。
 */
export async function writePluginConfig(filePath, value, { verify, backupDir, pluginId = "gemini-parameter", now } = {}) {
    let text;
    try {
        text = await readFile(filePath, "utf8");
    }
    catch (error) {
        if (error?.code === "ENOENT")
            throw fail("FILE_NOT_FOUND", "配置文件不存在: " + filePath);
        throw fail("READ_FAILED", "读取配置文件失败: " + (error?.message ?? error));
    }
    const meta = locateConfigBlock(text, pluginId);
    const configIndent = meta.lines[meta.configLine - 1].length - meta.lines[meta.configLine - 1].replace(/^ +/, "").length;
    const block = emitConfigBlock(value, configIndent);
    // 重建整文件：config: 行之前原样 + config: 行 + 规范块 + 其余行原样。
    const rebuilt = [
        ...meta.lines.slice(0, meta.configLine),
        ...block,
        ...meta.lines.slice(meta.blockEnd - 1)
    ].join("\n");
    // 回读校验（对重建后的全文做，确保最终落盘形态可解析）。
    let parsed;
    try {
        const check = await readPluginConfigText(rebuilt, pluginId);
        parsed = check.config;
    }
    catch (error) {
        throw fail("ROUNDTRIP_FAILED", "重建后的 config 块无法解析: " + (error?.message ?? error));
    }
    if (verify) {
        const verdict = verify(parsed);
        if (!verdict || verdict.ok !== true)
            throw fail("VERIFY_FAILED", "写入被校验拒绝: " + (verdict?.message ?? "未知原因"));
    }
    const stamp = timestamp(now);
    const tmpPath = join(dirname(filePath), "." + basename(filePath) + ".tmp-" + stamp);
    await writeFile(tmpPath, rebuilt, "utf8");
    let backupFile = null;
    try {
        // 校验通过后才备份并覆盖。
        if (backupDir) {
            await mkdir(backupDir, { recursive: true });
            backupFile = join(backupDir, basename(filePath) + "." + stamp + ".yml");
            await copyFile(filePath, backupFile);
        }
        await rename(tmpPath, filePath);
    }
    catch (error) {
        try {
            await unlink(tmpPath);
        }
        catch { /* 临时文件清理失败不影响结果 */ }
        throw fail("WRITE_FAILED", "写回配置文件失败: " + (error?.message ?? error));
    }
    return { configFile: filePath, backupFile, applied: parsed };
}

/** readPluginConfig 的纯文本版（校验重建文本用）。 */
async function readPluginConfigText(text, pluginId) {
    const meta = locateConfigBlock(text, pluginId);
    const rows = significantFromLines(linesSlice(meta.lines, meta.blockStart, meta.blockEnd));
    let config = null;
    if (rows.length > 0) {
        const configIndent = meta.lines[meta.configLine - 1].length - meta.lines[meta.configLine - 1].replace(/^ +/, "").length;
        const node = parseNode(rows, 0, configIndent - 1);
        config = node.value === EMPTY ? null : node.value;
    }
    return { config, meta };
}
