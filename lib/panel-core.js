/**
 * panel-core.js — 配置面板的宿主侧逻辑（纯逻辑，无 typert 依赖，可单测）。
 *
 * 面板服务的四个方法都在这里实现；lib/panel-service.js 只负责把它挂到
 * TypertRemoteService 上。这样本地单测不需要解析 @deepseek-ai/dsh-typert-protocol
 * （它只在 DSH 宿主里可达，见维护文档「上游脆弱点」）。
 *
 * 设计要点：
 *   - 权威校验永远是 normalizeConfig（与挂载期同一套规则）；前端镜像校验只是
 *     第一道体验优化，服务端保存前与落盘后各再校验一次；
 *   - 「是否已重启生效」= 文件配置(normalize 后) ≠ 内存生效配置（深比较），
 *     或文件 mtime 晚于宿主进程启动时间。二者取或，宁可多提醒不漏提醒；
 *   - 一切失败都以带 code 的 Error 抛出（typert 会转成 {ok:false,error} 信封），
 *     message 面向用户可读。
 */

import { normalizeConfig } from "./index.js";
import { cloneJson, deepEqual, readPluginConfig, writePluginConfig } from "./config-file.js";
import { revealFileInFileManager } from "./reveal.js";

export const PANEL_SERVICE = "geminiParameterPanel";

/** 「还原默认」写入的显式默认配置（与文档/README 的默认示例一致）。 */
export const DEFAULT_PANEL_CONFIG = {
    hosts: ["generativelanguage.googleapis.com"],
    endpoints: [":generateContent", ":streamGenerateContent"],
    mode: "merge",
    safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ],
    serverTimeoutSeconds: 1200,
    officialParams: {},
    debugDumpTo: null,
    log: false,
    onUnsupportedBody: "skip"
};

function fail(code, message) {
    const error = new Error("[" + code + "] " + message);
    error.code = code;
    return error;
}

/* ── typert 描述符（恒等 codec：严格校验由本文件/normalizeConfig 承担） ── */

const identityCodec = (symbol) => ({ mode: "strict", typeSymbol: symbol, create: () => ({ parse: (value) => value }) });

/** 宿主侧 MANIFEST（ctx.typert.register 用）。 */
export function buildPanelManifest(packageName) {
    return { package: packageName, face: "host", schemas: [], invocations: buildDescriptors(packageName) };
}

/** 客户端侧 CONTRIBUTION（ctx.remote.$mount 用）。 */
export function buildPanelContribution(packageName) {
    return { package: packageName, descriptors: buildDescriptors(packageName) };
}

function buildDescriptors(packageName) {
    const codec = identityCodec;
    const defs = [
        { method: "getInfo", parameters: [] },
        { method: "saveConfig", parameters: [{ name: "config", wire: "config", source: "json", codec: codec(packageName + "#Config") }] },
        { method: "resetDefaults", parameters: [] },
        { method: "revealConfigFile", parameters: [] }
    ];
    return defs.map((def) => ({
        id: packageName + "#" + PANEL_SERVICE + "/" + def.method,
        service: PANEL_SERVICE,
        namespace: PANEL_SERVICE,
        method: def.method,
        invocation: { kind: "direct" },
        parameters: def.parameters,
        result: codec(packageName + "#" + def.method + "Result")
    }));
}

/* ── 服务方法 ── */

/**
 * deps：
 *   configFile     插件包自身 cordis.patch.yml 绝对路径
 *   backupDir      时间戳备份目录（包内 .config-backups\）
 *   activeConfig   apply 时归一化后的生效配置（只读快照）
 *   stats          fetch 包装层的计数器对象（活引用）
 *   version / packageName / bootTime
 *   read/write/reveal 仅测试注入
 */
export function createPanelMethods(deps) {
    const { configFile, backupDir, activeConfig, stats, version = "0", packageName = "dsh-gemini-parameter", bootTime = null } = deps;
    const read = deps.read ?? ((path) => readPluginConfig(path));
    const write = deps.write ?? ((path, value, options) => writePluginConfig(path, value, options));
    const reveal = deps.reveal ?? ((path) => revealFileInFileManager(path));

    async function getInfo() {
        const active = cloneJson(activeConfig) ?? null;
        let fileConfig = null;
        let fileError = null;
        let fileExists = true;
        let mtimeMs = null;
        try {
            const result = await read(configFile);
            fileConfig = result.config;
            mtimeMs = result.mtimeMs;
        }
        catch (error) {
            if (error?.code === "FILE_NOT_FOUND") {
                fileExists = false;
            }
            else {
                fileExists = true;
                fileError = String(error?.message ?? error);
            }
        }
        let normalizedFile = null;
        if (fileConfig != null) {
            try {
                normalizedFile = normalizeConfig(cloneJson(fileConfig));
            }
            catch (error) {
                fileError = (fileError === null ? "" : fileError + "; ") + "文件里的 config 无法通过校验: " + String(error?.message ?? error);
            }
        }
        const differsFromActive = normalizedFile !== null && !deepEqual(normalizedFile, active);
        const fileChangedSinceBoot = mtimeMs !== null && bootTime !== null && mtimeMs > bootTime;
        return {
            version,
            packageName,
            configFile,
            backupDir,
            activeConfig: active,
            fileConfig: normalizedFile,
            fileExists,
            // 客户端契约字段名：lib/client.js 读取 info.readError
            readError: fileError,
            fileMtimeIso: mtimeMs === null ? null : new Date(mtimeMs).toISOString(),
            hostBootIso: bootTime === null ? null : new Date(bootTime).toISOString(),
            fileChangedSinceBoot,
            differsFromActive,
            needsRestart: differsFromActive || fileChangedSinceBoot,
            stats: stats ? { ...stats } : null
        };
    }

    async function saveConfig(candidate) {
        if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate))
            throw fail("INVALID_CONFIG", "config 必须是一个对象（YAML 映射），收到: " + typeof candidate);
        let normalized;
        try {
            normalized = normalizeConfig(cloneJson(candidate));
        }
        catch (error) {
            throw fail("INVALID_CONFIG", "配置校验失败: " + String(error?.message ?? error));
        }
        // 落盘前后的双重保险：写临时文件 → 回读解析 → 再 normalize 必须等于待写值。
        const verdict = (parsed) => {
            try {
                const again = normalizeConfig(cloneJson(parsed));
                return { ok: deepEqual(again, normalized), value: again, message: deepEqual(again, normalized) ? undefined : "回读结果与待写配置不一致" };
            }
            catch (error) {
                return { ok: false, message: String(error?.message ?? error) };
            }
        };
        let written;
        try {
            written = await write(configFile, normalized, { verify: verdict, backupDir });
        }
        catch (error) {
            const code = error?.code ?? "WRITE_FAILED";
            if (code === "VERIFY_FAILED" || code === "ROUNDTRIP_FAILED")
                throw fail("WRITE_UNSAFE", "写入未执行（回读校验未通过）: " + String(error?.message ?? error));
            throw fail(code === "INVALID_CONFIG" ? "INVALID_CONFIG" : "WRITE_FAILED", String(error?.message ?? error));
        }
        return {
            configFile: written.configFile,
            backupFile: written.backupFile,
            applied: normalized,
            needsRestart: true,
            warnings: []
        };
    }

    async function resetDefaults() {
        const result = await saveConfig(DEFAULT_PANEL_CONFIG);
        return { ...result, resetToDefaults: true };
    }

    async function revealConfigFile() {
        const result = await reveal(configFile);
        if (!result || result.ok !== true)
            throw fail("REVEAL_FAILED", "打开配置文件失败: " + String(result?.error ?? "未知原因"));
        return { path: result.path };
    }

    return { getInfo, saveConfig, resetDefaults, revealConfigFile };
}
