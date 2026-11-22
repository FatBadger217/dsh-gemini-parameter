/**
 * reveal.js — 在系统资源管理器里定位（选中）一个文件。零依赖。
 *
 * 给配置面板的「打开配置文件」按钮用。模式取自 dsh-skill-mcp-panel 的
 * reveal.js（同宿主生态里验证过的做法）：
 *   - Windows：explorer.exe /select,<反斜杠路径>（explorer 不认正斜杠，
 *     会静默打开「文档」而非目标；且即便成功也常返回非 0，不等退出码）；
 *   - macOS：open -R <路径>（在 Finder 中显示并选中）；
 *   - Linux：xdg-open <父目录>（没有统一的选中协议，退而打开所在目录）。
 *
 * 安全边界：只接受已存在的绝对路径；不上 shell、不拼命令；spawn 后即脱管
 * （fire-and-forget），错误只记日志。
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, dirname } from "node:path";

/** 把路径换成本机分隔符（Windows 上 explorer 只认 `\`）。导出供测试断言。 */
export function nativePath(raw) {
    const text = String(raw ?? "");
    if (process.platform !== "win32")
        return text;
    const replaced = text.replace(/\//g, "\\");
    const trimmed = replaced.replace(/\\+$/, "");
    if (trimmed === "")
        return replaced;
    if (trimmed.endsWith(":"))
        return trimmed + "\\";
    return trimmed;
}

/** 平台对应的「定位文件」命令（导出供测试断言）。 */
export function revealCommand(target, platform = process.platform) {
    const path = nativePath(String(target ?? "").trim());
    if (platform === "win32")
        return { command: "explorer.exe", args: ["/select," + path] };
    if (platform === "darwin")
        return { command: "open", args: ["-R", path] };
    return { command: "xdg-open", args: [dirname(path)] };
}

/**
 * 在资源管理器中定位文件。spawnImpl 仅测试里替换（断言命令、避免真弹窗）。
 * 返回 { ok: true, path, command } 或 { ok: false, error }。
 */
export async function revealFileInFileManager(rawPath, spawnImpl = spawn) {
    const raw = String(rawPath ?? "").trim();
    if (raw === "")
        return { ok: false, error: "路径为空" };
    const target = nativePath(raw);
    if (!isAbsolute(target))
        return { ok: false, error: "需要绝对路径：" + target };
    let info;
    try {
        info = await stat(target);
    }
    catch {
        return { ok: false, error: "文件不存在：" + target };
    }
    if (!info.isFile())
        return { ok: false, error: "不是文件：" + target };
    const { command, args } = revealCommand(target);
    try {
        const child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
        child.on?.("error", () => { });
        child.unref?.();
    }
    catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
    }
    return { ok: true, path: target, command };
}
