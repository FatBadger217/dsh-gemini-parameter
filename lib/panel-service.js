/**
 * panel-service.js — 把 panel-core 的方法挂到 Typert 远程服务上（薄适配层）。
 *
 * ⚠ 解析策略（P1 探针实证，见 draft 验证记录与本文件 git 历史）：
 * bare import "@deepseek-ai/dsh-typert-protocol" 只在 DSH Loader 的解析通道
 * 里可用（dsh-skill-mcp-panel 那类物理安装在 profile node_modules 的包也不走
 * 普通 Node 解析——profile 的 @deepseek-ai 下并没有这个包）。本插件是
 * link:/路径 挂载，动态 import 走普通 ESM 解析，直接 ModuleNotFound。
 *
 * 因此这里做三级异步解析（仍零依赖）：
 *   1. bare 动态 import —— Loader 通道可用时（未来 DSH 版本）直接成功；
 *   2. 从宿主进程入口推导：process.argv 里指向 @deepseek-ai\dsh\ 的条目，
 *      其目录下的 node_modules 就是 dsh 自带子包的物理位置，用 createRequire
 *      解析后按 file:// URL import；
 *   3. 全部失败：面板降级缺席（主功能不受影响），并把原因写入 debugDumpTo。
 *
 * 注册流程（registerPanel，async）：
 *   1. 构造 Gateway —— 构造即注册 "geminiParameterPanel" cordis 服务；
 *   2. ctx.effect(() => ctx.typert.register(MANIFEST)) —— 让 API 网关分发端点。
 *      typert 网关不存在的环境（headless 探针）只记日志跳过。
 */

import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { buildPanelManifest, createPanelMethods, PANEL_SERVICE } from "./panel-core.js";

/** 面板注册结果写入 debugDumpTo（JSONL，一行），供无日志环境的排障探针使用。 */
async function dumpPanelState(deps, state, error) {
    const target = deps?.debugDumpTo;
    if (typeof target !== "string" || target === "")
        return;
    try {
        const line = JSON.stringify({
            time: new Date().toISOString(),
            panel: PANEL_SERVICE,
            state,
            ...(error === undefined ? {} : { error: String(error?.message ?? error) })
        }) + "\n";
        await appendFile(target, line, "utf8");
    }
    catch { /* 诊断写失败绝不影响主流程 */ }
}

/** 候选的 dsh 安装目录（宿主进程入口 / 环境变量）。 */
function dshInstallCandidates() {
    const out = [];
    for (const arg of process.argv) {
        if (typeof arg !== "string")
            continue;
        const mark = arg.indexOf(join("@deepseek-ai", "dsh"));
        if (mark > 0)
            out.push(arg.slice(0, mark + join("@deepseek-ai", "dsh").length));
    }
    if (typeof process.env.DSH_ROOT === "string" && process.env.DSH_ROOT !== "")
        out.push(process.env.DSH_ROOT);
    return [...new Set(out)].slice(0, 4);
}

/**
 * 三级解析 TypertRemoteService。返回 class；找不到返回 null。
 * 导出供测试断言（本地无 typert-protocol 时返回 null，不抛错）。
 */
export async function resolveTypertRemoteService() {
    // 1) bare 动态 import（Loader 通道）。
    try {
        const mod = await import("@deepseek-ai/dsh-typert-protocol");
        if (mod && typeof mod.TypertRemoteService === "function")
            return mod.TypertRemoteService;
    }
    catch { /* 落到下一级 */ }
    // 2) 从 dsh 安装目录用 createRequire 解析。
    for (const root of dshInstallCandidates()) {
        try {
            const req = createRequire(join(root, "probe.cjs"));
            const resolved = req.resolve("@deepseek-ai/dsh-typert-protocol");
            const mod = await import(pathToFileURL(resolved).href);
            if (mod && typeof mod.TypertRemoteService === "function")
                return mod.TypertRemoteService;
        }
        catch { /* 试下一个候选 */ }
    }
    return null;
}

/**
 * 在插件 fiber 内注册面板服务（async）。返回清理函数；面板不可用时返回 noop
 * 并把原因写进 debugDumpTo。
 *
 * 注册用 cordis 的动态注入（ctx.inject(['typert'], cb)，cordis/lib/index.js:1672）：
 * 子 fiber 只在 typert 服务可用时启动，headless 等没有 typert 的环境里回调
 * 永不执行、也不报错——主插件（fetch 注入）零影响。绝不能给插件声明静态
 * inject: ['typert']，那会让整个插件等 typert 才启动。
 */
export async function registerPanel(ctx, deps) {
    const TypertRemoteService = await resolveTypertRemoteService();
    if (TypertRemoteService === null) {
        ctx?.logger?.warn?.("[gemini-parameter] 未找到 @deepseek-ai/dsh-typert-protocol，配置面板不可用（不影响参数注入）");
        await dumpPanelState(deps, "typert-unresolved");
        return () => { };
    }
    const methods = createPanelMethods(deps);
    const packageName = deps.packageName ?? "dsh-gemini-parameter";
    const Gateway = class GeminiParameterGateway extends TypertRemoteService {
        constructor(context) {
            super(context, PANEL_SERVICE);
            this.__methods = methods;
        }
        getInfo() {
            return this.__methods.getInfo();
        }
        saveConfig(config) {
            return this.__methods.saveConfig(config);
        }
        resetDefaults() {
            return this.__methods.resetDefaults();
        }
        revealConfigFile() {
            return this.__methods.revealConfigFile();
        }
    };
    let subFiber = null;
    try {
        subFiber = ctx.inject(["typert"], (panelCtx) => {
            new Gateway(panelCtx); // 构造即注册 "geminiParameterPanel" cordis 服务。
            panelCtx.effect(() => panelCtx.typert.register(buildPanelManifest(packageName)), "gemini-parameter: typert manifest");
            ctx?.logger?.info?.("[gemini-parameter] 配置面板服务已注册 (" + PANEL_SERVICE + ")");
            void dumpPanelState(deps, "registered");
            return () => { };
        });
        await dumpPanelState(deps, "subfiber-scheduled");
    }
    catch (error) {
        ctx?.logger?.warn?.("[gemini-parameter] 配置面板子 fiber 创建失败（不影响参数注入）: " + String(error?.message ?? error));
        await dumpPanelState(deps, "failed", error);
        return () => { };
    }
    return () => {
        try {
            subFiber?.dispose?.();
        }
        catch { /* 清理失败不阻断 */ }
    };
}
