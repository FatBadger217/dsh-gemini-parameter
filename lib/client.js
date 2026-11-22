window.__ModuleLoader__.load({
    id: "dsh-gemini-parameter",
    factory: (require) => {
        const bundleModule = { exports: {} };
        Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" });
        // ── 束契约 ───────────────────────────────────────────────────────────
        // 本文件由宿主以 /plugins/dsh-gemini-parameter/client.js 提供，只 require
        // react（手写 createElement，不引 jsx-runtime）。无侧栏图标，
        // 因此也不再 require primitives：所有图形都是本文件内的内联 SVG。
        const react = require("react");
        const h = react.createElement;

        // ── 恒定标识 ─────────────────────────────────────────────────────────
        const NS = "settings.geminiParameter";
        // 唯一的挂载点：官方插件管理页「本插件详情」内的配置区。
        // key 必须是包名，插件页据此认定本插件「有配置」（configured）。
        const CONFIG_SLOT = "plugins.bundle.config";
        const SERVICE = "geminiParameterPanel";
        const PACKAGE_NAME = "dsh-gemini-parameter";
        // 兜底显示版本：仅当宿主 info.version 缺失时用到（浏览器端读不到
        // package.json，发版时手动同步一次）。
        const FALLBACK_VERSION = "0.1.1";
        // 提示里引用的「profile 组合层」示例路径。只作为反例出现，本插件从不写它。
        const PROFILE_PATCH_EXAMPLE = "~/.dsh/profiles/<profile-name>/cordis.patch.yml";

        // ── 与服务端保持同形的校验常量 ───────────────────────────────────────
        const VALID_MODES = ["merge", "replace", "insert-only"];
        const VALID_THRESHOLDS = [
            "HARM_BLOCK_THRESHOLD_UNSPECIFIED",
            "BLOCK_LOW_AND_ABOVE",
            "BLOCK_MEDIUM_AND_ABOVE",
            "BLOCK_ONLY_HIGH",
            "BLOCK_NONE",
            "OFF"
        ];
        const STANDARD_CATEGORIES = [
            "HARM_CATEGORY_HARASSMENT",
            "HARM_CATEGORY_HATE_SPEECH",
            "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            "HARM_CATEGORY_DANGEROUS_CONTENT"
        ];
        const VALID_TIERS = ["standard", "flex", "priority"];
        const VALID_BODY_POLICIES = ["skip", "error"];
        const CATEGORY_PATTERN = /^HARM_CATEGORY_[A-Z0-9_]+$/;
        // 与服务端 lib/index.js 的 HOSTNAME_PATTERN 完全一致（允许 "*." 前缀通配）。
        const HOSTNAME_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

        /**
         * officialParams.generationConfig 的可编辑子键。kind 决定控件形态：
         *   number / int → 文本输入（保存前转数字）
         *   bool         → 三态下拉（未设置 / true / false）
         *   text         → 文本输入
         *   json         → JSON 文本域（解析校验，expect 指定期望的 JSON 形状）
         */
        const GEN_FIELDS = [
            { key: "temperature", kind: "number", group: "sampling" },
            { key: "topP", kind: "number", group: "sampling" },
            { key: "topK", kind: "int", group: "sampling" },
            { key: "candidateCount", kind: "int", group: "sampling" },
            { key: "maxOutputTokens", kind: "int", group: "sampling" },
            { key: "presencePenalty", kind: "number", group: "sampling" },
            { key: "frequencyPenalty", kind: "number", group: "sampling" },
            { key: "seed", kind: "int", group: "sampling" },
            { key: "responseLogprobs", kind: "bool", group: "sampling" },
            { key: "logprobs", kind: "int", group: "sampling" },
            { key: "stopSequences", kind: "json", group: "output", expect: "stringArray" },
            { key: "responseMimeType", kind: "text", group: "output" },
            { key: "responseModalities", kind: "json", group: "output", expect: "stringArray" },
            { key: "mediaResolution", kind: "text", group: "output" },
            { key: "responseSchema", kind: "json", group: "output", expect: "object" },
            { key: "responseJsonSchema", kind: "json", group: "output", expect: "object" },
            { key: "thinkingConfig", kind: "json", group: "advanced", expect: "object" },
            { key: "speechConfig", kind: "json", group: "advanced", expect: "object" },
            { key: "enableEnhancedCivicAnswers", kind: "bool", group: "advanced" }
        ];

        const GEN_GROUPS = [
            { id: "sampling", labelKey: "genGroupSampling" },
            { id: "output", labelKey: "genGroupOutput" },
            { id: "advanced", labelKey: "genGroupAdvanced" }
        ];

        const STAT_FIELDS = [
            { key: "matched", labelKey: "statsMatched" },
            { key: "injected", labelKey: "statsInjected" },
            { key: "paramsInjected", labelKey: "statsParamsInjected" },
            { key: "timeoutHeaders", labelKey: "statsTimeout" },
            { key: "unsupported", labelKey: "statsUnsupported" },
            { key: "failed", labelKey: "statsFailed" },
            { key: "relaySpotted", labelKey: "statsRelaySpotted" }
        ];

        // 已知的代理改写前缀 → 目标插件名。浏览态概览里用它把 /bili/ 这类前缀
        // 直接标注成「兼容 billion-context」，省得用户再去翻 README。
        const KNOWN_RELAY_TARGETS = { "/bili/": "billion-context" };

        // ── 样式 ─────────────────────────────────────────────────────────────
        // 不引样式框架：一个 <style> 标签，配色优先取宿主主题变量。
        //
        // 布局铁律（禁视口化布局，防滚动失效）：
        //   1) 本组件在插件详情页的 <section data-plugin-config> 内，宽度由页面容器
        //      决定，页面自身才是滚动容器 —— 组件里绝不做视口化布局；
        //   2) 不出现 position:fixed（唯一例外：确认对话框遮罩）、不出现
        //      100vh/calc(100vh)、不出现 overflow:hidden 的容器；
        //   3) 根节点由内容撑高（flex column + gap），区块纵向堆叠、width:100%；
        //   4) 只有 JSON 预览这类局部小区域用 max-height + overflow:auto。
        //
        // 颜色：每个语义变量都写成 var(--dsh-alias-X, var(--dsw-alias-X, 静态回退))。
        // 宿主当前实际提供的是 --dsw-alias-*（定义在 body 上，会随
        // body[data-ds-dark-theme] 切换）；前面的 --dsh-alias-* 是兼容写法，
        // 两层都取不到时才落到静态浅色回退，因此浅/深主题都保持可读。
        const CSS = [
            ".gp-root{--gp-fg:var(--dsh-alias-label-primary,var(--dsw-alias-label-primary,#1f2329));--gp-muted:var(--dsh-alias-label-secondary,var(--dsw-alias-label-secondary,#5b6472));--gp-faint:var(--dsh-alias-label-tertiary,var(--dsw-alias-label-tertiary,#8a919e));--gp-line:var(--dsh-alias-border-l2,var(--dsw-alias-border-l2,#e4e6eb));--gp-line-strong:var(--dsh-alias-border-l3,var(--dsw-alias-border-l3,#d3d6dd));--gp-surface:var(--dsh-alias-bg-layer-1,var(--dsw-alias-bg-layer-1,#fff));--gp-inset:color-mix(in srgb,var(--gp-fg) 6%,transparent);--gp-accent:var(--dsh-alias-link,var(--dsw-alias-link,#4b6bff));--gp-primary-bg:var(--dsh-alias-button-primary-fill,var(--dsw-alias-button-primary-fill,#1f2329));--gp-primary-fg:var(--dsh-alias-label-primary-foreground,var(--dsw-alias-label-primary-foreground,#fff));--gp-danger:var(--dsh-alias-state-error-primary,var(--dsw-alias-state-error-primary,#c62828));--gp-ok:var(--dsh-alias-state-success-primary,var(--dsw-alias-state-success-primary,#1a8a4a));--gp-warn:var(--dsh-alias-state-warn-label,var(--dsw-alias-state-warn-label,#a86500));--gp-info:var(--dsh-alias-state-business-primary,var(--dsw-alias-state-business-primary,#3b5bdb));--gp-ok-text:color-mix(in srgb,var(--gp-ok) 68%,var(--gp-fg));--gp-warn-text:color-mix(in srgb,var(--gp-warn) 68%,var(--gp-fg));--gp-danger-text:color-mix(in srgb,var(--gp-danger) 72%,var(--gp-fg));--gp-info-text:color-mix(in srgb,var(--gp-info) 72%,var(--gp-fg));--gp-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;display:flex;flex-direction:column;gap:12px;width:100%;color:var(--gp-fg);font-size:13px;line-height:1.6;text-align:left}",
            ".gp-root *{box-sizing:border-box}",
            ".gp-summary{font-size:12px;line-height:1.5;color:var(--dsh-alias-label-secondary,var(--dsw-alias-label-secondary,#5b6472))}",
            // 头部：标题 + 状态徽标 + 版本，右侧动作簇（随编辑/浏览两态切换）
            ".gp-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px 16px;justify-content:space-between}",
            ".gp-head-main{flex:1 1 320px;min-width:0}",
            ".gp-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
            ".gp-title{margin:0;font-size:15px;line-height:22px;font-weight:600}",
            ".gp-ver{font-family:var(--gp-mono);font-size:11px;line-height:16px;color:var(--gp-faint);border:1px solid var(--gp-line);border-radius:999px;padding:0 7px;white-space:nowrap}",
            ".gp-badge{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;line-height:18px;font-weight:500;border-radius:999px;padding:0 9px;border:1px solid transparent;white-space:nowrap}",
            ".gp-badge:before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}",
            ".gp-badge[data-tone=ok]{color:var(--gp-ok-text);background:color-mix(in srgb,var(--gp-ok) 13%,transparent);border-color:color-mix(in srgb,var(--gp-ok) 30%,transparent)}",
            ".gp-badge[data-tone=warn]{color:var(--gp-warn-text);background:color-mix(in srgb,var(--gp-warn) 15%,transparent);border-color:color-mix(in srgb,var(--gp-warn) 32%,transparent)}",
            ".gp-sub{margin:4px 0 0;color:var(--gp-muted);font-size:12.5px;line-height:1.55;max-width:640px}",
            ".gp-head-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:auto}",
            // 卡片
            ".gp-card{background:var(--gp-surface);border:1px solid var(--gp-line);border-radius:12px;padding:14px 16px}",
            ".gp-card[data-tone=notice]{background:color-mix(in srgb,var(--gp-warn) 4%,var(--gp-surface));border-color:color-mix(in srgb,var(--gp-warn) 24%,var(--gp-line))}",
            ".gp-card[data-tone=error]{background:color-mix(in srgb,var(--gp-danger) 4%,var(--gp-surface));border-color:color-mix(in srgb,var(--gp-danger) 26%,var(--gp-line))}",
            ".gp-card[data-tone=error] .gp-card-title{color:var(--gp-danger-text)}",
            ".gp-card-title{margin:0;font-size:13.5px;line-height:20px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
            ".gp-card-desc{margin:4px 0 0;font-size:12.5px;line-height:1.55;color:var(--gp-muted)}",
            ".gp-tag{font-size:11px;line-height:16px;font-weight:500;color:var(--gp-muted);background:var(--gp-inset);border-radius:5px;padding:0 6px;white-space:nowrap}",
            ".gp-tag[data-tone=warn]{color:var(--gp-warn-text);background:color-mix(in srgb,var(--gp-warn) 14%,transparent)}",
            // 提示条
            ".gp-banner{display:flex;align-items:flex-start;gap:8px;border-radius:10px;padding:9px 11px;font-size:12.5px;line-height:1.55;border:1px solid transparent}",
            ".gp-banner[data-tone=error]{color:var(--gp-danger-text);background:color-mix(in srgb,var(--gp-danger) 9%,var(--gp-surface));border-color:color-mix(in srgb,var(--gp-danger) 30%,transparent)}",
            ".gp-banner[data-tone=success]{color:var(--gp-ok-text);background:color-mix(in srgb,var(--gp-ok) 10%,var(--gp-surface));border-color:color-mix(in srgb,var(--gp-ok) 28%,transparent)}",
            ".gp-banner[data-tone=info]{color:var(--gp-info-text);background:color-mix(in srgb,var(--gp-info) 9%,var(--gp-surface));border-color:color-mix(in srgb,var(--gp-info) 26%,transparent)}",
            ".gp-banner-main{flex:1 1 auto;min-width:0}",
            ".gp-banner-title{margin:0;font-weight:600;font-size:12.5px}",
            ".gp-banner-body{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.55;font-family:var(--gp-mono)}",
            ".gp-banner-close{flex:none;border:0;background:transparent;color:inherit;font-size:15px;line-height:1;cursor:pointer;padding:2px 4px;opacity:.65;border-radius:5px}",
            ".gp-banner-close:hover{opacity:1;background:var(--gp-inset)}",
            // 路径 / 元信息 / 键值
            ".gp-path{margin:10px 0 0;font-family:var(--gp-mono);font-size:12px;line-height:1.5;background:var(--gp-inset);border:1px solid var(--gp-line);border-radius:8px;padding:7px 9px;overflow-wrap:anywhere}",
            ".gp-hint{margin:0;font-size:11.5px;line-height:1.55;color:var(--gp-muted)}",
            ".gp-hint-block{margin-top:7px}",
            ".gp-warn-text{color:var(--gp-warn-text)}",
            ".gp-meta{margin:9px 0 0;font-family:var(--gp-mono);font-size:11px;line-height:1.6;color:var(--gp-faint);overflow-wrap:anywhere}",
            ".gp-kv{display:grid;grid-template-columns:168px minmax(0,1fr);gap:8px 16px;align-items:start;margin:12px 0 0}",
            ".gp-k{color:var(--gp-muted);font-size:11.5px;line-height:1.6;padding-top:1px;font-family:var(--gp-mono)}",
            ".gp-v{min-width:0;font-size:12.5px;line-height:1.6;overflow-wrap:anywhere}",
            ".gp-mono{font-family:var(--gp-mono);font-size:12px}",
            ".gp-chip{display:inline-block;margin:0 5px 4px 0;padding:0 7px;line-height:18px;border-radius:5px;background:var(--gp-inset);font-family:var(--gp-mono);font-size:11.5px}",
            ".gp-block{border-top:1px solid var(--gp-line);margin-top:14px;padding-top:12px}",
            ".gp-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:10px}",
            ".gp-stat{background:var(--gp-inset);border-radius:8px;padding:7px 9px}",
            ".gp-stat-num{font-size:16px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums}",
            ".gp-stat-label{font-size:11px;line-height:1.4;color:var(--gp-muted)}",
            // 表单
            ".gp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px}",
            ".gp-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
            ".gp-field[data-span=full]{grid-column:1/-1}",
            ".gp-label{font-size:12px;line-height:1.5;font-weight:600}",
            ".gp-input,.gp-select,.gp-textarea{font:inherit;font-size:12.5px;color:var(--gp-fg);background:var(--gp-surface);border:1px solid var(--gp-line-strong);border-radius:7px;padding:5px 8px;min-width:0;width:100%}",
            ".gp-input::placeholder,.gp-textarea::placeholder{color:var(--gp-faint);opacity:.9}",
            ".gp-select{cursor:pointer}",
            ".gp-textarea{resize:vertical;line-height:1.5;font-family:var(--gp-mono);font-size:12px;min-height:64px}",
            ".gp-input:focus,.gp-select:focus,.gp-textarea:focus{outline:2px solid color-mix(in srgb,var(--gp-accent) 40%,transparent);outline-offset:1px;border-color:var(--gp-accent)}",
            ".gp-input[data-invalid=true],.gp-select[data-invalid=true],.gp-textarea[data-invalid=true]{border-color:var(--gp-danger);background:color-mix(in srgb,var(--gp-danger) 5%,var(--gp-surface))}",
            ".gp-input:disabled,.gp-select:disabled,.gp-textarea:disabled{opacity:.5;cursor:not-allowed}",
            ".gp-error{margin:0;font-size:11.5px;line-height:1.5;color:var(--gp-danger)}",
            ".gp-list{display:flex;flex-direction:column;gap:6px}",
            ".gp-list-item{display:flex;flex-direction:column;gap:3px}",
            ".gp-list-row{display:flex;gap:6px;align-items:center}",
            ".gp-list-row .gp-input{flex:1 1 auto}",
            ".gp-icon-btn{flex:none;width:28px;height:28px;border:1px solid var(--gp-line-strong);background:var(--gp-surface);border-radius:7px;color:var(--gp-muted);cursor:pointer;font-size:14px;line-height:1;padding:0}",
            ".gp-icon-btn:hover:not(:disabled){color:var(--gp-danger);border-color:color-mix(in srgb,var(--gp-danger) 45%,transparent);background:color-mix(in srgb,var(--gp-danger) 7%,var(--gp-surface))}",
            ".gp-icon-btn:disabled{opacity:.45;cursor:not-allowed}",
            ".gp-row-inline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px}",
            ".gp-switch{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;line-height:1.5;cursor:pointer;margin:0}",
            ".gp-switch input{width:14px;height:14px;accent-color:var(--gp-accent);cursor:pointer;margin:0;flex:none}",
            ".gp-switch input:disabled{cursor:not-allowed}",
            ".gp-json-area{display:flex;flex-direction:column;gap:5px;align-items:flex-start;width:100%}",
            ".gp-json-area .gp-textarea{width:100%}",
            // 按钮
            ".gp-btn{font:inherit;font-size:12.5px;line-height:18px;padding:5px 11px;border-radius:7px;border:1px solid var(--gp-line-strong);background:var(--gp-surface);color:var(--gp-fg);cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}",
            ".gp-btn:hover:not(:disabled){background:var(--gp-inset);border-color:color-mix(in srgb,var(--gp-fg) 24%,transparent)}",
            ".gp-btn:focus-visible{outline:2px solid color-mix(in srgb,var(--gp-accent) 45%,transparent);outline-offset:1px}",
            ".gp-btn:disabled{opacity:.45;cursor:not-allowed}",
            ".gp-btn[data-variant=primary]{background:var(--gp-primary-bg);border-color:var(--gp-primary-bg);color:var(--gp-primary-fg)}",
            ".gp-btn[data-variant=primary]:hover:not(:disabled){background:var(--gp-primary-bg);opacity:.86}",
            ".gp-btn[data-variant=danger]{color:var(--gp-danger-text);border-color:color-mix(in srgb,var(--gp-danger) 42%,transparent);background:transparent}",
            ".gp-btn[data-variant=danger]:hover:not(:disabled){background:color-mix(in srgb,var(--gp-danger) 9%,var(--gp-surface));border-color:color-mix(in srgb,var(--gp-danger) 55%,transparent)}",
            ".gp-btn[data-variant=ghost]{background:transparent;border-color:transparent;color:var(--gp-muted)}",
            ".gp-btn[data-variant=ghost]:hover:not(:disabled){background:var(--gp-inset);border-color:transparent;color:var(--gp-fg)}",
            ".gp-btn-sm{font-size:12px;padding:2px 8px;line-height:17px}",
            ".gp-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px;padding-top:13px;border-top:1px solid var(--gp-line)}",
            ".gp-actions-spacer{flex:1 1 0}",
            // 编辑区分区
            ".gp-section{margin-top:14px}",
            ".gp-section + .gp-section{border-top:1px dashed var(--gp-line);padding-top:14px}",
            ".gp-section-head{margin:0 0 10px}",
            ".gp-subhead{font-family:var(--gp-mono);font-size:12.5px;font-weight:600;margin:16px 0 4px;padding-top:12px;border-top:1px dashed var(--gp-line)}",
            ".gp-group{margin:0 0 14px}",
            ".gp-group-title{margin:0 0 8px;font-size:11px;font-weight:600;line-height:1.5;color:var(--gp-muted);text-transform:uppercase;letter-spacing:.04em}",
            // 安全阈值表
            ".gp-safety{display:flex;flex-direction:column;gap:7px;margin:0 0 10px}",
            ".gp-safety[data-disabled=true]{opacity:.55}",
            ".gp-safety-head{display:grid;grid-template-columns:minmax(0,1fr) 210px 28px;gap:8px;font-size:10.5px;line-height:1.5;color:var(--gp-faint);text-transform:uppercase;letter-spacing:.05em}",
            ".gp-safety-item{display:flex;flex-direction:column;gap:3px}",
            ".gp-safety-row{display:grid;grid-template-columns:minmax(0,1fr) 210px 28px;gap:8px;align-items:start}",
            ".gp-safety-cat{font-family:var(--gp-mono);font-size:11.5px;line-height:1.5;padding-top:6px;min-width:0;overflow-wrap:anywhere}",
            ".gp-safety-gap{display:block}",
            // 参数只读展示
            ".gp-details{border:1px solid var(--gp-line);border-radius:9px;padding:8px 10px;margin-top:12px;background:color-mix(in srgb,var(--gp-fg) 2%,transparent)}",
            ".gp-details>summary{cursor:pointer;font-size:12px;font-weight:600;line-height:1.6;color:var(--gp-muted)}",
            ".gp-details>summary:hover{color:var(--gp-fg)}",
            ".gp-details[open]>summary{margin-bottom:6px;color:var(--gp-fg)}",
            ".gp-pre{margin:6px 0 0;padding:9px 11px;background:var(--gp-inset);border-radius:8px;max-height:320px;overflow:auto;font-family:var(--gp-mono);font-size:11.5px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}",
            ".gp-param{display:grid;grid-template-columns:168px minmax(0,1fr);gap:6px 16px;font-size:12px}",
            ".gp-param-key{font-family:var(--gp-mono);font-size:11.5px;color:var(--gp-muted);overflow-wrap:anywhere}",
            ".gp-param-val{min-width:0;overflow-wrap:anywhere}",
            ".gp-subparam{padding-left:10px;border-left:2px solid var(--gp-line);display:grid;grid-template-columns:140px minmax(0,1fr);gap:4px 12px;font-size:11.5px}",
            // 状态
            ".gp-loading{display:flex;align-items:center;gap:8px;color:var(--gp-muted);font-size:12.5px;padding:10px 2px}",
            ".gp-spinner{display:inline-block;width:13px;height:13px;border:2px solid var(--gp-line);border-top-color:var(--gp-accent);border-radius:50%;animation:gp-spin .8s linear infinite;flex:none}",
            "@keyframes gp-spin{to{transform:rotate(360deg)}}",
            // 确认对话框：本组件唯一允许的 position:fixed（遮罩层），且不参与常态布局。
            ".gp-modal-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--dsh-alias-bg-mask-3,var(--dsw-alias-bg-mask-3,rgba(15,18,25,.45)))}",
            ".gp-modal{width:100%;max-width:440px;background:var(--gp-surface);border:1px solid var(--gp-line);border-radius:14px;padding:18px 20px;box-shadow:0 18px 48px rgba(15,18,25,.26)}",
            ".gp-modal-title{margin:0 0 6px;font-size:15px;line-height:22px;font-weight:600}",
            ".gp-modal-body{margin:0 0 16px;font-size:12.5px;line-height:1.6;color:var(--gp-muted);white-space:pre-wrap}",
            ".gp-modal-actions{display:flex;justify-content:flex-end;gap:8px}",
            // 窄容器：页面容器本身在窄屏会收窄到 ~320px
            "@media (max-width:760px){.gp-head-actions{width:100%;margin-left:0}.gp-grid{grid-template-columns:1fr}.gp-kv{grid-template-columns:1fr;gap:3px 0}.gp-k{padding-top:6px}.gp-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.gp-param{grid-template-columns:1fr}.gp-subparam{grid-template-columns:1fr}.gp-safety-head,.gp-safety-row{grid-template-columns:minmax(0,1fr) 136px 28px}}"
        ].join("");

        // 样式只注入一次；宿主热更新会整束重新加载，这里覆盖同一标签即可。
        const STYLE_ID = "dsh-gemini-parameter-config-css";
        if (typeof document !== "undefined" && document !== null && document.head) {
            let styleTag = document.getElementById(STYLE_ID);
            if (styleTag === null) {
                styleTag = document.createElement("style");
                styleTag.id = STYLE_ID;
                styleTag.dataset.plugin = PACKAGE_NAME;
                document.head.appendChild(styleTag);
            }
            styleTag.textContent = CSS;
        }

        // ── 字典 ─────────────────────────────────────────────────────────────
        // 没有侧栏入口，因此没有 nav 键；其余条目与字典一一对应。
        const zh = {
            title: "Gemini 参数配置",
            subtitle: "保存只写回本插件包内的 cordis.patch.yml（不写 profile 组合层），重启 dsh web 后生效。",
            summary: "查看与编辑注入到 Gemini 请求的安全阈值、超时头与官方参数（保存后需重启 dsh web）",
            versionLabel: "版本",
            badgeOk: "已生效",
            badgeWarn: "配置已修改，重启 dsh web 后生效",
            loading: "正在读取配置…",
            loadFailed: "读取配置失败",
            retry: "重试",
            noInfo: "尚未读取到配置信息。",
            dismiss: "关闭提示",
            fileCardTitle: "配置文件位置",
            fileCardBody: "配置保存在本插件包自身的 cordis.patch.yml（插件目录下的配置文件）：",
            fileCardWarn: "注意：不是 DSH profile 组合层的 cordis.patch.yml（例如 {profile}）——本插件不写那个文件。",
            fileMissing: "配置文件不存在，保存时会自动创建。",
            fileReadError: "读取配置文件失败：{message}",
            fileMtimeLabel: "文件修改时间",
            bootLabel: "本次启动时间",
            fileChangedNote: "提示：配置文件在本次启动之后被修改过（内容与内存中的配置一致）。",
            overviewTitle: "当前生效配置",
            overviewDesc: "以下为宿主内存中实际生效的归一化配置；重启 dsh web 后才会与文件一致。",
            labelHosts: "hosts（匹配主机）",
            labelEndpoints: "endpoints（路径后缀）",
            labelMode: "mode（安全设置合并方式）",
            labelSafety: "safetySettings",
            labelTimeout: "serverTimeoutSeconds",
            labelOfficial: "officialParams",
            labelDebug: "debugDumpTo",
            labelLog: "log",
            labelUnsupported: "onUnsupportedBody",
            labelStats: "请求统计（本次启动以来）",
            valueSafetyOff: "未注入（保持 Google 默认高限制）",
            valueTimeoutOff: "不发送 X-Server-Timeout 头",
            valueTimeoutOn: "{seconds} 秒",
            valueOfficialEmpty: "（空，不注入额外参数）",
            valueDebugOff: "关闭（不写转储文件）",
            valueLogOn: "开启（每次注入写一行宿主日志）",
            valueLogOff: "关闭",
            modeMerge: "merge — 保留 SDK 已发送的类别，补上/覆盖本插件配置的类别",
            modeReplace: "replace — 用本插件配置整体替换 SDK 发送的 safetySettings",
            modeInsertOnly: "insert-only — 仅当请求完全没有 safetySettings 时才插入",
            unsupportedSkip: "skip — 跳过该请求（不注入，原样放行）",
            unsupportedError: "error — 抛出错误，请求直接失败（排查用）",
            hint_onUnsupportedBody: "只影响请求体不是可解析 JSON 的请求：skip 原样放行，error 抛错便于定位。",
            statsMatched: "匹配请求",
            statsInjected: "注入安全设置",
            statsParamsInjected: "注入官方参数",
            statsTimeout: "超时头",
            statsUnsupported: "不支持的 body",
            statsFailed: "失败",
            statsRelaySpotted: "代理改写（未兼容）",
            relayWarnTitle: "检测到 billion-context 等代理插件改写的模型请求",
            relayWarnBody: "统计里出现「代理改写」说明有模型流量经过本插件但主机名已是本地代理（127.0.0.1），按原始主机匹配不到、注入未生效。若你安装了 billion-context，请在「网络匹配」里给 relayUnwrap 添加一行 /bili/ 并保存重启；详见 README 的「与 billion-context 共存」。",
            labelRelay: "relayUnwrap（代理兼容）",
            valueRelayOff: "关闭（默认）",
            relayCompatWith: "→ 兼容 {plugin}",
            relayPurposeHint: "用于兼容会改写请求网址的插件（如 billion-context），配置方法见 README",
            fileDiffTitle: "配置文件中的配置与内存不同 · 展开查看",
            fileDiffDesc: "重启 dsh web 后，文件中的配置才会生效。",
            editButton: "编辑配置",
            editTitle: "编辑配置",
            editDesc: "修改后点击「保存并写回配置文件」。保存只改文件，重启 dsh web 后生效。",
            sectionNetwork: "网络匹配",
            sectionNetworkDesc: "只处理命中这些主机与路径后缀的请求；其它请求原样放行。",
            fieldHosts: "hosts",
            fieldHostsHint: "每行一个主机名；支持 *. 前缀通配。留空项会被忽略。",
            fieldEndpoints: "endpoints",
            fieldEndpointsHint: "每行一个以 : 开头的路径后缀，例如 :generateContent。",
            fieldRelayUnwrap: "relayUnwrap（代理兼容，可选）",
            fieldRelayUnwrapHint: "安装了 billion-context 等会把请求改写成本地代理地址的插件时，填 /bili/ 以识别其中的原始网址；留空关闭。",
            errRelayPrefix: "无效的前缀：{value}（须以 / 开头，例如 /bili/）",
            addItem: "添加",
            removeItem: "删除这一项",
            sectionSafety: "安全阈值",
            sectionSafetyDesc: "总开关关闭时整组不注入，Google 默认限制保持不变。",
            safetyToggle: "注入 safetySettings（关闭 = 保持 Google 默认高限制）",
            safetyCategory: "类别",
            safetyThreshold: "阈值",
            safetyUnset: "未注入（该类别不出现在数组里）",
            safetyLegend: "阈值含义：BLOCK_NONE 全部放行（最宽松）；BLOCK_ONLY_HIGH 仅拦截高概率；BLOCK_MEDIUM_AND_ABOVE 拦截中及以上；BLOCK_LOW_AND_ABOVE 拦截低及以上（最严格）；OFF 关闭该类过滤；HARM_BLOCK_THRESHOLD_UNSPECIFIED 交给 API 默认。",
            addCustomCategory: "添加自定义类别",
            sectionRequest: "请求行为",
            sectionRequestDesc: "合并方式、超时头、日志与调试转储；未命中的请求永远原样放行。",
            fieldMode: "mode",
            fieldTimeout: "serverTimeoutSeconds",
            timeoutEnable: "发送 X-Server-Timeout 头",
            timeoutHint: "整数 1..1200（秒）；关闭时不发送该头。",
            fieldUnsupported: "onUnsupportedBody",
            fieldDebug: "debugDumpTo",
            debugHint: "调试转储文件路径；留空表示关闭（保存为 null）。",
            fieldLog: "log",
            logLabel: "在宿主日志中记录每次注入",
            sectionOfficial: "官方参数（officialParams）",
            sectionOfficialDesc: "只允许白名单字段；留空的字段不会写入配置。复杂值用 JSON 文本域编辑。",
            fieldServiceTier: "serviceTier",
            tierUnset: "未设置",
            fieldCachedContent: "cachedContent",
            fieldLabels: "labels",
            fieldToolConfig: "toolConfig",
            jsonParse: "解析并格式化",
            hint_serviceTier: "服务层级：standard / flex / priority；留空不设置。",
            hint_cachedContent: "已缓存内容的资源名，例如 cachedContents/abc123；留空不设置。",
            hint_labels: "JSON 对象，例如 {\"team\":\"dsh\"}。",
            hint_toolConfig: "JSON 对象（函数调用配置）。",
            hint_temperature: "采样温度（通常 0..2）。",
            hint_topP: "核采样概率（通常 0..1）。",
            hint_topK: "候选词数量（整数）。",
            hint_candidateCount: "生成候选数（整数，通常 1..8）。",
            hint_maxOutputTokens: "最大输出 token 数（整数）。",
            hint_presencePenalty: "存在惩罚（数字）。",
            hint_frequencyPenalty: "频率惩罚（数字）。",
            hint_seed: "随机种子（整数）。",
            hint_responseLogprobs: "是否返回 logprobs（布尔）。",
            hint_logprobs: "返回的候选 logprob 数（整数，通常 0..5）。",
            hint_stopSequences: "停止序列，JSON 字符串数组，例如 [\"END\"]。",
            hint_responseMimeType: "响应 MIME 类型，例如 application/json。",
            hint_responseModalities: "响应模态，JSON 字符串数组，例如 [\"TEXT\"]。",
            hint_mediaResolution: "媒体分辨率枚举，例如 MEDIA_RESOLUTION_HIGH。",
            hint_responseSchema: "响应 JSON Schema 对象。",
            hint_responseJsonSchema: "响应 JSON Schema（JSON Schema 形式）对象。",
            hint_thinkingConfig: "思考配置对象，例如 {\"thinkingBudget\":1024}。",
            hint_speechConfig: "语音配置对象。",
            hint_enableEnhancedCivicAnswers: "增强公民回答（布尔）。",
            genGroupSampling: "采样与长度",
            genGroupOutput: "输出格式与 Schema",
            genGroupAdvanced: "高级",
            sectionGenDesc: "按需填写；留空的字段不会写入。数值字段保存前会校验为数字/整数。",
            boolUnset: "未设置",
            boolTrue: "true（启用）",
            boolFalse: "false（关闭）",
            previewTitle: "预览将要保存的配置（JSON）",
            previewDesc: "这是将发送给宿主的 config 对象；服务端还会再权威校验一次。",
            actionSave: "保存并写回配置文件",
            actionReset: "还原默认值",
            actionReveal: "打开配置文件",
            actionReload: "重新读取",
            actionCancel: "取消编辑",
            busySave: "保存中…",
            busyReset: "还原中…",
            busyReveal: "打开中…",
            busyReload: "读取中…",
            unsaved: "有未保存的修改",
            errorsSummary: "有 {count} 处需要修正，请检查标红的字段。",
            saveSuccess: "保存成功",
            saveSuccessBody: "配置已写回插件包内的 cordis.patch.yml。",
            backupFile: "备份文件：{path}",
            restartNeeded: "重启 dsh web 后生效。",
            warningsTitle: "服务端提示：",
            resetSuccessBody: "默认配置已写回配置文件。",
            revealSuccess: "已在资源管理器中选中配置文件",
            reloadSuccess: "已重新读取配置文件",
            actionFailed: "操作失败",
            confirmResetTitle: "还原默认值？",
            confirmResetBody: "将把插件配置文件重写为默认值（四类安全阈值 BLOCK_NONE、超时 1200 秒、官方参数为空），当前文件会被备份。此操作需要重启 dsh web 后生效。",
            confirmDiscardTitle: "放弃未保存的修改？",
            confirmDiscardBody: "当前表单中的修改尚未保存，离开后将丢失。",
            confirmReloadTitle: "重新读取配置文件？",
            confirmReloadBody: "重新读取会丢弃当前表单中未保存的修改。",
            confirmOk: "确认",
            confirmCancel: "取消",
            errRemoteMissing: "宿主未注册 geminiParameterPanel 远程服务（插件服务端半区未加载？）。",
            errListEmpty: "{field} 至少需要一个条目",
            errHost: "无效的主机名：{value}（只允许字母、数字、点和连字符，可带 *. 前缀）",
            errEndpoint: "无效的路径后缀：{value}（必须以 : 开头）",
            errEnum: "取值无效：{value}",
            errSafetyEmpty: "已开启注入，但没有任何类别；请至少选择一个阈值，或关闭总开关。",
            errSafetyCategory: "无效的类别：{value}（应形如 HARM_CATEGORY_XXX）",
            errSafetyDuplicate: "类别重复：{value}",
            errSafetyThreshold: "无效的阈值：{value}",
            errTimeout: "必须是 1..1200 之间的整数（当前：{value}）",
            errNumber: "必须是数字（当前：{value}）",
            errInteger: "必须是整数（当前：{value}）",
            errJson: "JSON 解析失败：{message}",
            errObject: "必须是 JSON 对象（{…}）",
            errArray: "必须是 JSON 数组（[…]）",
            errStringArray: "必须是字符串数组，例如 [\"TEXT\"]"
        };

        const en = {
            title: "Gemini parameters",
            subtitle: "Saving writes only this plugin package's own cordis.patch.yml (never the profile layer); restart dsh web to apply.",
            summary: "Review and edit the safety thresholds, timeout header and official parameters injected into Gemini requests (restart dsh web to apply).",
            versionLabel: "Version",
            badgeOk: "Active",
            badgeWarn: "Configuration changed — restart dsh web to apply",
            loading: "Loading configuration…",
            loadFailed: "Failed to load configuration",
            retry: "Retry",
            noInfo: "No configuration information yet.",
            dismiss: "Dismiss",
            fileCardTitle: "Where the configuration lives",
            fileCardBody: "Configuration is stored in this plugin package's own cordis.patch.yml:",
            fileCardWarn: "This is not the DSH profile composition layer (e.g. {profile}) — this plugin never writes that file.",
            fileMissing: "The configuration file does not exist yet; saving will create it.",
            fileReadError: "Failed to read the configuration file: {message}",
            fileMtimeLabel: "File modified",
            bootLabel: "Host started",
            fileChangedNote: "Note: the file was modified after this host started (its content matches the in-memory configuration).",
            overviewTitle: "Configuration in effect",
            overviewDesc: "Normalized configuration currently active in host memory; it matches the file only after a dsh web restart.",
            labelHosts: "hosts (matched hosts)",
            labelEndpoints: "endpoints (path suffixes)",
            labelMode: "mode (safety merge mode)",
            labelSafety: "safetySettings",
            labelTimeout: "serverTimeoutSeconds",
            labelOfficial: "officialParams",
            labelDebug: "debugDumpTo",
            labelLog: "log",
            labelUnsupported: "onUnsupportedBody",
            labelStats: "Request counters (since this boot)",
            valueSafetyOff: "Not injected (Google's default strict thresholds stay in place)",
            valueTimeoutOff: "X-Server-Timeout header is not sent",
            valueTimeoutOn: "{seconds} seconds",
            valueOfficialEmpty: "(empty — no extra parameters injected)",
            valueDebugOff: "Off (no dump file)",
            valueLogOn: "On (one host log line per injected request)",
            valueLogOff: "Off",
            modeMerge: "merge — keep categories the SDK sent, add/override the configured ones",
            modeReplace: "replace — the configured list replaces whatever the SDK sent",
            modeInsertOnly: "insert-only — only insert when the request has no safetySettings at all",
            unsupportedSkip: "skip — leave the request untouched",
            unsupportedError: "error — throw and fail the request (for debugging)",
            hint_onUnsupportedBody: "Only affects requests whose body is not parseable JSON: skip passes them through, error throws to make the problem visible.",
            statsMatched: "Matched",
            statsInjected: "Safety injected",
            statsParamsInjected: "Params injected",
            statsTimeout: "Timeout header",
            statsUnsupported: "Unsupported body",
            statsFailed: "Failed",
            statsRelaySpotted: "Relay-rewritten (compat off)",
            relayWarnTitle: "Relay-rewritten model requests detected (e.g. billion-context)",
            relayWarnBody: "A non-zero counter above means model traffic passes through this plugin with its host already rewritten to a local proxy (127.0.0.1), so the host whitelist cannot match and nothing is injected. If you run billion-context, add /bili/ to relayUnwrap under “Network matching”, save and restart — see “Coexistence with billion-context” in the README.",
            labelRelay: "relayUnwrap (relay compat)",
            valueRelayOff: "Off (default)",
            relayCompatWith: "→ compat with {plugin}",
            relayPurposeHint: "Compat with URL-rewriting plugins (e.g. billion-context); see the README for setup",
            fileDiffTitle: "The file differs from memory · expand",
            fileDiffDesc: "The file's configuration takes effect after a dsh web restart.",
            editButton: "Edit configuration",
            editTitle: "Edit configuration",
            editDesc: "Click “Save and write back”. Saving only writes the file; a dsh web restart applies it.",
            sectionNetwork: "Network matching",
            sectionNetworkDesc: "Only requests matching these hosts and path suffixes are touched; everything else passes through.",
            fieldHosts: "hosts",
            fieldHostsHint: "One host per line; a leading *. wildcard is allowed. Empty rows are ignored.",
            fieldEndpoints: "endpoints",
            fieldEndpointsHint: "One path suffix per line, starting with a colon, e.g. :generateContent.",
            fieldRelayUnwrap: "relayUnwrap (relay compat, optional)",
            fieldRelayUnwrapHint: "When a plugin like billion-context rewrites requests to a local proxy address, add /bili/ here to match the embedded original URL. Leave empty to disable.",
            errRelayPrefix: "Invalid prefix: {value} (must start with /, e.g. /bili/)",
            addItem: "Add",
            removeItem: "Remove this entry",
            sectionSafety: "Safety thresholds",
            sectionSafetyDesc: "When the master switch is off, nothing is injected and Google's default limits stay in place.",
            safetyToggle: "Inject safetySettings (off = keep Google's default strict limits)",
            safetyCategory: "Category",
            safetyThreshold: "Threshold",
            safetyUnset: "Not injected (category omitted from the array)",
            safetyLegend: "Thresholds: BLOCK_NONE lets everything through (loosest); BLOCK_ONLY_HIGH blocks high probability only; BLOCK_MEDIUM_AND_ABOVE blocks medium and above; BLOCK_LOW_AND_ABOVE blocks low and above (strictest); OFF disables that filter; HARM_BLOCK_THRESHOLD_UNSPECIFIED uses the API default.",
            addCustomCategory: "Add custom category",
            sectionRequest: "Request behaviour",
            sectionRequestDesc: "Merge mode, timeout header, logging and debug dump; unmatched requests always pass through untouched.",
            fieldMode: "mode",
            fieldTimeout: "serverTimeoutSeconds",
            timeoutEnable: "Send the X-Server-Timeout header",
            timeoutHint: "Integer 1..1200 (seconds); when off the header is not sent.",
            fieldUnsupported: "onUnsupportedBody",
            fieldDebug: "debugDumpTo",
            debugHint: "Debug dump file path; leave empty to disable (saved as null).",
            fieldLog: "log",
            logLabel: "Log every injection to the host log",
            sectionOfficial: "Official parameters (officialParams)",
            sectionOfficialDesc: "Whitelisted fields only; empty fields are not written. Complex values use JSON text areas.",
            fieldServiceTier: "serviceTier",
            tierUnset: "Not set",
            fieldCachedContent: "cachedContent",
            fieldLabels: "labels",
            fieldToolConfig: "toolConfig",
            jsonParse: "Parse & format",
            hint_serviceTier: "Service tier: standard / flex / priority; empty means unset.",
            hint_cachedContent: "Cached content resource name, e.g. cachedContents/abc123; empty means unset.",
            hint_labels: "JSON object, e.g. {\"team\":\"dsh\"}.",
            hint_toolConfig: "JSON object (function-calling configuration).",
            hint_temperature: "Sampling temperature (usually 0..2).",
            hint_topP: "Nucleus sampling probability (usually 0..1).",
            hint_topK: "Number of candidate tokens (integer).",
            hint_candidateCount: "Number of candidates (integer, usually 1..8).",
            hint_maxOutputTokens: "Maximum output tokens (integer).",
            hint_presencePenalty: "Presence penalty (number).",
            hint_frequencyPenalty: "Frequency penalty (number).",
            hint_seed: "Random seed (integer).",
            hint_responseLogprobs: "Whether to return logprobs (boolean).",
            hint_logprobs: "Number of candidate logprobs to return (integer, usually 0..5).",
            hint_stopSequences: "Stop sequences, JSON string array, e.g. [\"END\"].",
            hint_responseMimeType: "Response MIME type, e.g. application/json.",
            hint_responseModalities: "Response modalities, JSON string array, e.g. [\"TEXT\"].",
            hint_mediaResolution: "Media resolution enum, e.g. MEDIA_RESOLUTION_HIGH.",
            hint_responseSchema: "Response JSON Schema object.",
            hint_responseJsonSchema: "Response JSON Schema (JSON Schema form) object.",
            hint_thinkingConfig: "Thinking configuration object, e.g. {\"thinkingBudget\":1024}.",
            hint_speechConfig: "Speech configuration object.",
            hint_enableEnhancedCivicAnswers: "Enhanced civic answers (boolean).",
            genGroupSampling: "Sampling & length",
            genGroupOutput: "Output format & schema",
            genGroupAdvanced: "Advanced",
            sectionGenDesc: "Fill in only what you need; empty fields are not written. Numeric fields are validated on save.",
            boolUnset: "Not set",
            boolTrue: "true (enabled)",
            boolFalse: "false (disabled)",
            previewTitle: "Preview of the configuration to save (JSON)",
            previewDesc: "This is the config object sent to the host; the server validates it again.",
            actionSave: "Save and write back",
            actionReset: "Restore defaults",
            actionReveal: "Open configuration file",
            actionReload: "Reload",
            actionCancel: "Cancel editing",
            busySave: "Saving…",
            busyReset: "Restoring…",
            busyReveal: "Opening…",
            busyReload: "Loading…",
            unsaved: "Unsaved changes",
            errorsSummary: "{count} field(s) need attention — check the highlighted ones.",
            saveSuccess: "Saved",
            saveSuccessBody: "The configuration was written back to the plugin's cordis.patch.yml.",
            backupFile: "Backup file: {path}",
            restartNeeded: "Restart dsh web to apply.",
            warningsTitle: "Server warnings:",
            resetSuccessBody: "The default configuration was written back.",
            revealSuccess: "Selected the configuration file in the file manager",
            reloadSuccess: "Configuration reloaded",
            actionFailed: "Action failed",
            confirmResetTitle: "Restore defaults?",
            confirmResetBody: "The plugin configuration file will be rewritten with the defaults (four safety categories at BLOCK_NONE, 1200 s timeout, empty officialParams). The current file is backed up. A dsh web restart is required.",
            confirmDiscardTitle: "Discard unsaved changes?",
            confirmDiscardBody: "The form has unsaved changes; leaving now will lose them.",
            confirmReloadTitle: "Reload the configuration file?",
            confirmReloadBody: "Reloading discards unsaved changes in the form.",
            confirmOk: "Confirm",
            confirmCancel: "Cancel",
            errRemoteMissing: "The host did not register the geminiParameterPanel remote service (is the server half loaded?).",
            errListEmpty: "{field} needs at least one entry",
            errHost: "Invalid host: {value} (letters, digits, dots and hyphens only; an optional *. prefix)",
            errEndpoint: "Invalid path suffix: {value} (must start with a colon)",
            errEnum: "Invalid value: {value}",
            errSafetyEmpty: "Injection is on but no category is selected; pick at least one threshold or turn the switch off.",
            errSafetyCategory: "Invalid category: {value} (expected HARM_CATEGORY_XXX)",
            errSafetyDuplicate: "Duplicate category: {value}",
            errSafetyThreshold: "Invalid threshold: {value}",
            errTimeout: "Must be an integer in 1..1200 (got {value})",
            errNumber: "Must be a number (got {value})",
            errInteger: "Must be an integer (got {value})",
            errJson: "JSON parse failed: {message}",
            errObject: "Must be a JSON object ({…})",
            errArray: "Must be a JSON array ([…])",
            errStringArray: "Must be an array of strings, e.g. [\"TEXT\"]"
        };

        // ── 纯函数工具 ───────────────────────────────────────────────────────
        function isPlainObject(value) {
            return value !== null && typeof value === "object" && !Array.isArray(value);
        }

        function fill(template, params) {
            let text = typeof template === "string" ? template : String(template);
            if (!isPlainObject(params)) return text;
            for (const key of Object.keys(params)) {
                text = text.split("{" + key + "}").join(String(params[key]));
            }
            return text;
        }

        function replaceAt(list, index, value) {
            const next = list.slice();
            next[index] = value;
            return next;
        }

        function withoutAt(list, index) {
            return list.filter((item, position) => position !== index);
        }

        function safeStringify(value) {
            try {
                const text = JSON.stringify(value, null, 2);
                return typeof text === "string" ? text : String(value);
            } catch (error) {
                return String(value);
            }
        }

        function formatTimestamp(value) {
            if (typeof value !== "string" || value === "") return String(value === undefined || value === null ? "" : value);
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return value;
            const pad = (part) => (part < 10 ? "0" + part : String(part));
            return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
                " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
        }

        function domId(path) {
            return "gp-" + String(path).replace(/[^a-zA-Z0-9_-]+/g, "-");
        }

        /**
         * 解析一个 JSON 文本域。state:
         *   empty  → 留空（不写入配置）
         *   ok     → value 可用
         *   error  → message 是本地化后的错误
         */
        function parseJsonText(text, expect, tr) {
            const raw = String(text === undefined || text === null ? "" : text).trim();
            if (raw === "") return { state: "empty" };
            let value;
            try {
                value = JSON.parse(raw);
            } catch (error) {
                return { state: "error", message: tr("errJson", { message: error && error.message ? error.message : String(error) }) };
            }
            if (expect === "object" && !isPlainObject(value)) return { state: "error", message: tr("errObject") };
            if (expect === "array" && !Array.isArray(value)) return { state: "error", message: tr("errArray") };
            if (expect === "stringArray") {
                const valid = Array.isArray(value) && value.every((item) => typeof item === "string");
                if (!valid) return { state: "error", message: tr("errStringArray") };
            }
            return { state: "ok", value };
        }

        function formatGenValue(kind, value) {
            if (value === undefined || value === null) return "";
            if (kind === "bool") return value === true ? "true" : value === false ? "false" : String(value);
            if (kind === "json") return safeStringify(value);
            if (typeof value === "string") return value;
            if (typeof value === "number" || typeof value === "boolean") return String(value);
            return safeStringify(value);
        }

        /** 表单模型 ← 服务端归一化配置（fileConfig 或 activeConfig）。 */
        function configToModel(config) {
            const source = isPlainObject(config) ? config : {};
            const hosts = Array.isArray(source.hosts) && source.hosts.length > 0 ? source.hosts.map((entry) => String(entry)) : [""];
            const endpoints = Array.isArray(source.endpoints) && source.endpoints.length > 0 ? source.endpoints.map((entry) => String(entry)) : [""];
            const relay = Array.isArray(source.relayUnwrap) && source.relayUnwrap.length > 0 ? source.relayUnwrap.map((entry) => String(entry)) : [""];

            // 服务端把「关闭」归一化成 null（原样写 false 也读成 null），因此这里只认数组。
            const safety = Array.isArray(source.safetySettings) ? source.safetySettings.filter(isPlainObject) : null;
            const safetyRows = STANDARD_CATEGORIES.map((category) => {
                const hit = safety === null ? undefined : safety.filter((entry) => String(entry.category).toUpperCase() === category)[0];
                return {
                    category,
                    threshold: hit !== undefined && typeof hit.threshold === "string" ? hit.threshold : "",
                    custom: false
                };
            });
            if (safety !== null) {
                for (const entry of safety) {
                    const category = typeof entry.category === "string" ? entry.category : "";
                    if (STANDARD_CATEGORIES.indexOf(category.toUpperCase()) !== -1) continue;
                    safetyRows.push({
                        category,
                        threshold: typeof entry.threshold === "string" ? entry.threshold : "",
                        custom: true
                    });
                }
            }

            const params = isPlainObject(source.officialParams) ? source.officialParams : {};
            const generation = isPlainObject(params.generationConfig) ? params.generationConfig : {};
            const gen = {};
            for (const field of GEN_FIELDS) gen[field.key] = formatGenValue(field.kind, generation[field.key]);

            const timeout = source.serverTimeoutSeconds;
            return {
                hosts,
                endpoints,
                relay,
                mode: typeof source.mode === "string" && source.mode !== "" ? source.mode : "merge",
                safetyEnabled: safety !== null,
                safetyRows,
                timeoutEnabled: timeout !== null && timeout !== undefined && timeout !== false,
                timeoutText: timeout === null || timeout === undefined || timeout === false ? "1200" : String(timeout),
                serviceTier: typeof params.serviceTier === "string" ? params.serviceTier : "",
                cachedContent: typeof params.cachedContent === "string" ? params.cachedContent : "",
                labelsText: params.labels === undefined ? "" : safeStringify(params.labels),
                toolConfigText: params.toolConfig === undefined ? "" : safeStringify(params.toolConfig),
                gen,
                debugDumpTo: typeof source.debugDumpTo === "string" ? source.debugDumpTo : "",
                log: source.log === true,
                onUnsupportedBody: VALID_BODY_POLICIES.indexOf(source.onUnsupportedBody) !== -1 ? source.onUnsupportedBody : "skip"
            };
        }

        /**
         * 表单模型 → 服务端 config。同时按服务端 normalizeConfig 的规则做镜像校验：
         * 枚举、整数范围、正则、数组类型、JSON 形状。返回 { config, errors }，
         * errors 的键是字段路径（"hosts.0" / "officialParams.labels" / ...）。
         */
        function validateModel(model, tr) {
            const errors = {};
            const add = (path, message) => {
                if (!Object.prototype.hasOwnProperty.call(errors, path)) errors[path] = message;
            };
            const source = isPlainObject(model) ? model : configToModel({});
            const hostRows = Array.isArray(source.hosts) ? source.hosts : [];
            const endpointRows = Array.isArray(source.endpoints) ? source.endpoints : [];
            const relayRows = Array.isArray(source.relay) ? source.relay : [];
            const safetyRows = Array.isArray(source.safetyRows) ? source.safetyRows : [];
            const gen = isPlainObject(source.gen) ? source.gen : {};

            // hosts
            const hosts = [];
            hostRows.forEach((raw, index) => {
                const value = String(raw === undefined || raw === null ? "" : raw).trim();
                if (value === "") return;
                if (!HOSTNAME_PATTERN.test(value)) {
                    add("hosts." + index, tr("errHost", { value }));
                    return;
                }
                hosts.push(value.toLowerCase());
            });
            if (hosts.length === 0) add("hosts", tr("errListEmpty", { field: "hosts" }));

            // endpoints
            const endpoints = [];
            endpointRows.forEach((raw, index) => {
                const value = String(raw === undefined || raw === null ? "" : raw).trim();
                if (value === "") return;
                if (value.charAt(0) !== ":" || value.length < 2) {
                    add("endpoints." + index, tr("errEndpoint", { value }));
                    return;
                }
                endpoints.push(value);
            });
            if (endpoints.length === 0) add("endpoints", tr("errListEmpty", { field: "endpoints" }));

            // relayUnwrap（可选；空列表 = 关闭）
            const relayUnwrap = [];
            relayRows.forEach((raw, index) => {
                const value = String(raw === undefined || raw === null ? "" : raw).trim();
                if (value === "") return;
                if (value.charAt(0) !== "/" || value.length < 2) {
                    add("relay." + index, tr("errRelayPrefix", { value }));
                    return;
                }
                relayUnwrap.push(value);
            });

            // mode
            const mode = VALID_MODES.indexOf(source.mode) !== -1 ? source.mode : "merge";
            if (source.mode !== mode) add("mode", tr("errEnum", { value: String(source.mode) }));

            // safetySettings
            let safetySettings = false;
            if (source.safetyEnabled === true) {
                const entries = [];
                const seen = {};
                safetyRows.forEach((row, index) => {
                    const threshold = String(row.threshold === undefined || row.threshold === null ? "" : row.threshold).trim().toUpperCase();
                    if (threshold === "") return;
                    const category = String(row.category === undefined || row.category === null ? "" : row.category).trim().toUpperCase();
                    const path = "safety." + index;
                    if (!CATEGORY_PATTERN.test(category)) {
                        add(path, tr("errSafetyCategory", { value: row.category === undefined ? "" : row.category }));
                        return;
                    }
                    if (seen[category] === true) {
                        add(path, tr("errSafetyDuplicate", { value: category }));
                        return;
                    }
                    if (VALID_THRESHOLDS.indexOf(threshold) === -1) {
                        add(path, tr("errSafetyThreshold", { value: threshold }));
                        return;
                    }
                    seen[category] = true;
                    entries.push({ category, threshold });
                });
                const hasRowError = Object.keys(errors).some((key) => key.indexOf("safety.") === 0);
                if (entries.length === 0 && !hasRowError) add("safety", tr("errSafetyEmpty"));
                safetySettings = entries;
            }

            // serverTimeoutSeconds
            let serverTimeoutSeconds = null;
            if (source.timeoutEnabled === true) {
                const text = String(source.timeoutText === undefined || source.timeoutText === null ? "" : source.timeoutText).trim();
                const numeric = Number(text);
                if (!/^\d+$/.test(text) || !Number.isSafeInteger(numeric) || numeric < 1 || numeric > 1200) {
                    add("serverTimeoutSeconds", tr("errTimeout", { value: text }));
                } else {
                    serverTimeoutSeconds = numeric;
                }
            }

            // officialParams
            const officialParams = {};
            const tier = String(source.serviceTier === undefined || source.serviceTier === null ? "" : source.serviceTier).trim();
            if (tier !== "") {
                if (VALID_TIERS.indexOf(tier) !== -1) officialParams.serviceTier = tier;
                else add("officialParams.serviceTier", tr("errEnum", { value: tier }));
            }
            const cachedContent = String(source.cachedContent === undefined || source.cachedContent === null ? "" : source.cachedContent).trim();
            if (cachedContent !== "") officialParams.cachedContent = cachedContent;

            const labels = parseJsonText(source.labelsText, "object", tr);
            if (labels.state === "error") add("officialParams.labels", labels.message);
            else if (labels.state === "ok") officialParams.labels = labels.value;

            const toolConfig = parseJsonText(source.toolConfigText, "object", tr);
            if (toolConfig.state === "error") add("officialParams.toolConfig", toolConfig.message);
            else if (toolConfig.state === "ok") officialParams.toolConfig = toolConfig.value;

            const generationConfig = {};
            for (const field of GEN_FIELDS) {
                const raw = String(gen[field.key] === undefined || gen[field.key] === null ? "" : gen[field.key]).trim();
                if (raw === "") continue;
                const path = "officialParams.generationConfig." + field.key;
                if (field.kind === "number" || field.kind === "int") {
                    const numeric = Number(raw);
                    if (!Number.isFinite(numeric)) {
                        add(path, tr("errNumber", { value: raw }));
                        continue;
                    }
                    if (field.kind === "int" && !Number.isSafeInteger(numeric)) {
                        add(path, tr("errInteger", { value: raw }));
                        continue;
                    }
                    generationConfig[field.key] = numeric;
                    continue;
                }
                if (field.kind === "bool") {
                    if (raw === "true") generationConfig[field.key] = true;
                    else if (raw === "false") generationConfig[field.key] = false;
                    else add(path, tr("errEnum", { value: raw }));
                    continue;
                }
                if (field.kind === "text") {
                    generationConfig[field.key] = raw;
                    continue;
                }
                const parsed = parseJsonText(raw, field.expect, tr);
                if (parsed.state === "error") add(path, parsed.message);
                else if (parsed.state === "ok") generationConfig[field.key] = parsed.value;
            }
            if (Object.keys(generationConfig).length > 0) officialParams.generationConfig = generationConfig;

            // debugDumpTo / log / onUnsupportedBody
            const debug = String(source.debugDumpTo === undefined || source.debugDumpTo === null ? "" : source.debugDumpTo).trim();
            const debugDumpTo = debug === "" ? null : debug;
            const onUnsupportedBody = VALID_BODY_POLICIES.indexOf(source.onUnsupportedBody) !== -1 ? source.onUnsupportedBody : "skip";
            if (source.onUnsupportedBody !== onUnsupportedBody) add("onUnsupportedBody", tr("errEnum", { value: String(source.onUnsupportedBody) }));

            return {
                config: {
                    hosts,
                    endpoints,
                    relayUnwrap,
                    mode,
                    safetySettings,
                    serverTimeoutSeconds,
                    officialParams,
                    debugDumpTo,
                    log: source.log === true,
                    onUnsupportedBody
                },
                errors
            };
        }

        // ── 错误显示 ─────────────────────────────────────────────────────────
        function remoteError(method, error) {
            const code = error !== null && typeof error === "object" && typeof error.code === "string" && error.code !== ""
                ? error.code
                : "REMOTE_ERROR";
            const message = error !== null && typeof error === "object" && typeof error.message === "string" && error.message !== ""
                ? error.message
                : String(error === undefined || error === null ? "unknown error" : error);
            const failure = new Error(code + ": " + message);
            failure.code = code;
            failure.detail = message;
            failure.method = method;
            return failure;
        }

        /** 表单里就地显示：只要服务端原文。 */
        function errorDetail(error) {
            if (error !== null && typeof error === "object") {
                if (typeof error.detail === "string" && error.detail !== "") return error.detail;
                if (typeof error.message === "string" && error.message !== "") return error.message;
            }
            return String(error === undefined || error === null ? "" : error);
        }

        /** 提示条用：带错误码，便于定位。 */
        function errorFull(error) {
            if (error !== null && typeof error === "object" && typeof error.code === "string" && typeof error.detail === "string") {
                return error.code + ": " + error.detail;
            }
            return errorDetail(error);
        }

        // ── 内联图形（不依赖 primitives，取不到宿主图标时的唯一形态）──────────
        function RefreshGlyph(props) {
            const size = props !== null && props !== undefined && typeof props.size === "number" && props.size > 0 ? props.size : 14;
            return h("svg", {
                width: size,
                height: size,
                viewBox: "0 0 16 16",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 1.5,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                "aria-hidden": "true",
                focusable: "false"
            },
                h("path", { d: "M13 8a5 5 0 1 1-1.6-3.7" }),
                h("path", { d: "M13 2.5V5h-2.5" })
            );
        }

        function FolderGlyph(props) {
            const size = props !== null && props !== undefined && typeof props.size === "number" && props.size > 0 ? props.size : 14;
            return h("svg", {
                width: size,
                height: size,
                viewBox: "0 0 16 16",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 1.5,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                "aria-hidden": "true",
                focusable: "false"
            },
                h("path", { d: "M1.8 4.2h4l1.4 1.6h7v6.4a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1Z" })
            );
        }

        function canListenDocument() {
            return typeof document !== "undefined" && document !== null &&
                typeof document.addEventListener === "function" &&
                typeof document.removeEventListener === "function";
        }

        /** 弹层按 Escape 关闭；组件只在打开时挂载，所以不需要额外开关。 */
        function useEscapeClose(onClose, enabled) {
            const active = enabled !== false;
            react.useEffect(() => {
                if (!active || !canListenDocument()) return undefined;
                const handler = (event) => {
                    if (event !== null && event !== undefined && event.key === "Escape") onClose();
                };
                document.addEventListener("keydown", handler);
                return () => document.removeEventListener("keydown", handler);
            }, [active]);
        }

        // ── 表单小部件 ───────────────────────────────────────────────────────
        function Field(props) {
            const label = props.label;
            const htmlFor = props.htmlFor;
            return h("div", { className: "gp-field", "data-span": props.span === "full" ? "full" : "half" },
                label === undefined || label === null ? null
                    : htmlFor === undefined || htmlFor === null
                        ? h("div", { className: "gp-label" }, label)
                        : h("label", { className: "gp-label", htmlFor }, label),
                props.children,
                props.error ? h("p", { className: "gp-error", role: "alert" }, props.error) : null,
                props.hint ? h("p", { className: "gp-hint" }, props.hint) : null
            );
        }

        function ListField(props) {
            const values = Array.isArray(props.values) ? props.values : [];
            return h("div", { className: "gp-field", "data-span": "full" },
                h("div", { className: "gp-label" }, props.label),
                h("div", { className: "gp-list" },
                    values.map((value, index) => {
                        const message = props.errors[props.prefix + "." + index];
                        return h("div", { className: "gp-list-item", key: props.prefix + "-" + index },
                            h("div", { className: "gp-list-row" },
                                h("input", {
                                    className: "gp-input gp-mono",
                                    type: "text",
                                    value,
                                    placeholder: props.placeholder,
                                    spellCheck: false,
                                    "aria-label": props.label + " " + (index + 1),
                                    "data-invalid": message ? "true" : "false",
                                    onChange: (event) => props.onChange(index, event.currentTarget.value)
                                }),
                                h("button", {
                                    type: "button",
                                    className: "gp-icon-btn",
                                    title: props.removeLabel,
                                    "aria-label": props.removeLabel,
                                    onClick: () => props.onRemove(index)
                                }, "×")
                            ),
                            message ? h("p", { className: "gp-error" }, message) : null
                        );
                    })
                ),
                h("div", { className: "gp-row-inline" },
                    h("button", {
                        type: "button",
                        className: "gp-btn gp-btn-sm",
                        "data-variant": "ghost",
                        onClick: props.onAdd
                    }, "+ " + props.addLabel)
                ),
                props.errors[props.prefix] ? h("p", { className: "gp-error gp-hint-block" }, props.errors[props.prefix]) : null,
                props.hint ? h("p", { className: "gp-hint" }, props.hint) : null
            );
        }

        function JsonArea(props) {
            const value = props.value === undefined || props.value === null ? "" : props.value;
            const format = () => {
                const raw = String(value).trim();
                if (raw === "") return;
                try {
                    props.onChange(JSON.stringify(JSON.parse(raw), null, 2));
                } catch (error) {
                    // 实时校验已在输入时标红；这里保持文本不动即可。
                }
            };
            return h("div", { className: "gp-json-area" },
                h("textarea", {
                    id: props.id,
                    className: "gp-textarea gp-mono",
                    rows: props.rows === undefined ? 6 : props.rows,
                    value,
                    spellCheck: false,
                    placeholder: props.placeholder === undefined ? "{\n  \"key\": \"value\"\n}" : props.placeholder,
                    "data-invalid": props.error ? "true" : "false",
                    onChange: (event) => props.onChange(event.currentTarget.value)
                }),
                h("button", {
                    type: "button",
                    className: "gp-btn gp-btn-sm",
                    "data-variant": "ghost",
                    onClick: format
                }, props.t("jsonParse"))
            );
        }

        function ConfirmDialog(props) {
            useEscapeClose(props.onCancel, props.busy !== true);
            return h("div", {
                className: "gp-modal-backdrop",
                role: "presentation",
                onMouseDown: (event) => {
                    if (event.target === event.currentTarget) props.onCancel();
                }
            },
                h("div", {
                    className: "gp-modal",
                    role: "dialog",
                    "aria-modal": "true",
                    "aria-label": props.title
                },
                    h("div", { className: "gp-modal-title" }, props.title),
                    h("p", { className: "gp-modal-body" }, props.body),
                    h("div", { className: "gp-modal-actions" },
                        h("button", {
                            type: "button",
                            className: "gp-btn",
                            "data-variant": "ghost",
                            disabled: props.busy === true,
                            onClick: props.onCancel
                        }, props.cancelLabel),
                        h("button", {
                            type: "button",
                            className: "gp-btn",
                            "data-variant": props.tone === "danger" ? "danger" : "primary",
                            disabled: props.busy === true,
                            onClick: props.onConfirm
                        }, props.confirmLabel)
                    )
                )
            );
        }

        // ── 只读展示 ─────────────────────────────────────────────────────────
        function renderParamBody(value) {
            if (value === null) return h("span", { className: "gp-mono" }, "null");
            if (typeof value === "object") {
                return h("details", { className: "gp-details", style: { marginTop: 0 } },
                    h("summary", null, Array.isArray(value) ? "array[" + value.length + "]" : "object{" + Object.keys(value).length + "}"),
                    h("pre", { className: "gp-pre" }, safeStringify(value))
                );
            }
            if (typeof value === "string") return h("span", { className: "gp-mono" }, value === "" ? "\"\"" : value);
            return h("span", { className: "gp-mono" }, String(value));
        }

        function OfficialParamsView(props) {
            const value = props.value;
            const keys = isPlainObject(value) ? Object.keys(value) : [];
            if (keys.length === 0) return h("span", { className: "gp-hint" }, props.t("valueOfficialEmpty"));
            return h("div", { className: "gp-param" },
                keys.map((key) => {
                    const entry = value[key];
                    if (key === "generationConfig" && isPlainObject(entry)) {
                        return [
                            h("div", { className: "gp-param-key", key: key + "-k" }, "generationConfig"),
                            h("div", { className: "gp-param-val", key: key + "-v" },
                                h("div", { className: "gp-subparam" },
                                    Object.keys(entry).map((sub) => [
                                        h("div", { className: "gp-param-key", key: sub + "-k" }, sub),
                                        h("div", { className: "gp-param-val", key: sub + "-v" }, renderParamBody(entry[sub]))
                                    ])
                                )
                            )
                        ];
                    }
                    return [
                        h("div", { className: "gp-param-key", key: key + "-k" }, key),
                        h("div", { className: "gp-param-val", key: key + "-v" }, renderParamBody(entry))
                    ];
                })
            );
        }

        function SafetySettingsView(props) {
            const value = props.value;
            if (!Array.isArray(value) || value.length === 0) {
                return h("span", { className: "gp-hint" }, props.t("valueSafetyOff"));
            }
            return h("div", null, value.map((entry, index) => {
                const category = entry !== null && typeof entry === "object" ? entry.category : entry;
                const threshold = entry !== null && typeof entry === "object" ? entry.threshold : "";
                return h("div", { key: "safety-view-" + index, style: { marginBottom: "2px" } },
                    h("span", { className: "gp-mono" }, String(category)),
                    h("span", { className: "gp-hint" }, "  →  "),
                    h("span", { className: "gp-mono" }, String(threshold))
                );
            }));
        }

        // ── 表单分区 ─────────────────────────────────────────────────────────
        function NetworkSection(props) {
            const model = props.model;
            const errors = props.errors;
            const t = props.t;
            const updateRows = props.updateRows;
            const setHost = (index, value) => updateRows("hosts", (rows) => replaceAt(rows, index, value), "hosts");
            const addHost = () => updateRows("hosts", (rows) => rows.concat([""]), "hosts");
            const removeHost = (index) => updateRows("hosts", (rows) => withoutAt(rows, index), "hosts");
            const setEndpoint = (index, value) => updateRows("endpoints", (rows) => replaceAt(rows, index, value), "endpoints");
            const addEndpoint = () => updateRows("endpoints", (rows) => rows.concat([""]), "endpoints");
            const removeEndpoint = (index) => updateRows("endpoints", (rows) => withoutAt(rows, index), "endpoints");
            const setRelay = (index, value) => updateRows("relay", (rows) => replaceAt(rows, index, value), "relay");
            const addRelay = () => updateRows("relay", (rows) => rows.concat([""]), "relay");
            const removeRelay = (index) => updateRows("relay", (rows) => withoutAt(rows, index), "relay");
            return h("div", { className: "gp-section" },
                h("div", { className: "gp-section-head" },
                    h("div", { className: "gp-card-title" }, t("sectionNetwork")),
                    h("p", { className: "gp-card-desc" }, t("sectionNetworkDesc"))
                ),
                h("div", { className: "gp-grid" },
                    h(ListField, {
                        label: t("fieldHosts"),
                        hint: t("fieldHostsHint"),
                        values: model.hosts,
                        errors,
                        prefix: "hosts",
                        placeholder: "generativelanguage.googleapis.com",
                        onChange: setHost,
                        onAdd: addHost,
                        onRemove: removeHost,
                        addLabel: t("addItem"),
                        removeLabel: t("removeItem")
                    }),
                    h(ListField, {
                        label: t("fieldEndpoints"),
                        hint: t("fieldEndpointsHint"),
                        values: model.endpoints,
                        errors,
                        prefix: "endpoints",
                        placeholder: ":generateContent",
                        onChange: setEndpoint,
                        onAdd: addEndpoint,
                        onRemove: removeEndpoint,
                        addLabel: t("addItem"),
                        removeLabel: t("removeItem")
                    })
                ),
                h(ListField, {
                    label: t("fieldRelayUnwrap"),
                    hint: t("fieldRelayUnwrapHint"),
                    values: model.relay,
                    errors,
                    prefix: "relay",
                    placeholder: "/bili/",
                    onChange: setRelay,
                    onAdd: addRelay,
                    onRemove: removeRelay,
                    addLabel: t("addItem"),
                    removeLabel: t("removeItem")
                })
            );
        }

        function SafetySection(props) {
            const model = props.model;
            const errors = props.errors;
            const t = props.t;
            const update = props.update;
            const clear = props.clear;
            const updateRows = props.updateRows;
            const enabled = model.safetyEnabled === true;
            const toggle = (next) => {
                let rows = model.safetyRows;
                if (next === true && rows.every((row) => String(row.threshold === undefined || row.threshold === null ? "" : row.threshold) === "")) {
                    // 从「整组关闭」重新打开且没有任何残留时，回填四类标准类别的 BLOCK_NONE，
                    // 省得用户还要逐条选一遍。
                    rows = rows.map((row) => (row.custom === true ? row : { category: row.category, threshold: "BLOCK_NONE", custom: false }));
                }
                clear("safety");
                update({ safetyEnabled: next, safetyRows: rows });
            };
            const setRow = (index, patch) => updateRows("safetyRows", (rows) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row)), "safety");
            const removeRow = (index) => updateRows("safetyRows", (rows) => withoutAt(rows, index), "safety");
            const addRow = () => updateRows("safetyRows", (rows) => rows.concat([{ category: "", threshold: "BLOCK_NONE", custom: true }]), "safety");
            return h("div", { className: "gp-section" },
                h("div", { className: "gp-section-head" },
                    h("div", { className: "gp-card-title" }, t("sectionSafety")),
                    h("p", { className: "gp-card-desc" }, t("sectionSafetyDesc"))
                ),
                h("label", { className: "gp-switch" },
                    h("input", {
                        type: "checkbox",
                        checked: enabled,
                        onChange: (event) => toggle(event.currentTarget.checked)
                    }),
                    h("span", null, t("safetyToggle"))
                ),
                errors.safety ? h("p", { className: "gp-error gp-hint-block", role: "alert" }, errors.safety) : null,
                h("div", { className: "gp-safety", "data-disabled": enabled ? "false" : "true", style: { marginTop: "10px" } },
                    h("div", { className: "gp-safety-head" },
                        h("span", null, t("safetyCategory")),
                        h("span", null, t("safetyThreshold")),
                        h("span", null, "")
                    ),
                    model.safetyRows.map((row, index) => {
                        const message = errors["safety." + index];
                        return h("div", { className: "gp-safety-item", key: "safety-row-" + index },
                            h("div", { className: "gp-safety-row" },
                                row.custom === true
                                    ? h("input", {
                                        className: "gp-input gp-mono",
                                        type: "text",
                                        value: row.category,
                                        placeholder: "HARM_CATEGORY_CUSTOM",
                                        spellCheck: false,
                                        disabled: !enabled,
                                        "aria-label": t("safetyCategory") + " " + (index + 1),
                                        "data-invalid": message ? "true" : "false",
                                        onChange: (event) => setRow(index, { category: event.currentTarget.value })
                                    })
                                    : h("div", { className: "gp-safety-cat" }, row.category),
                                h("select", {
                                    className: "gp-select gp-mono",
                                    value: row.threshold,
                                    disabled: !enabled,
                                    "aria-label": t("safetyThreshold") + " " + (index + 1),
                                    "data-invalid": message ? "true" : "false",
                                    onChange: (event) => setRow(index, { threshold: event.currentTarget.value })
                                },
                                    [h("option", { value: "", key: "unset" }, t("safetyUnset"))].concat(
                                        VALID_THRESHOLDS.map((threshold) => h("option", { value: threshold, key: threshold }, threshold))
                                    )
                                ),
                                row.custom === true
                                    ? h("button", {
                                        type: "button",
                                        className: "gp-icon-btn",
                                        title: t("removeItem"),
                                        "aria-label": t("removeItem"),
                                        disabled: !enabled,
                                        onClick: () => removeRow(index)
                                    }, "×")
                                    : h("span", { className: "gp-safety-gap" })
                            ),
                            message ? h("p", { className: "gp-error" }, message) : null
                        );
                    })
                ),
                h("div", { className: "gp-row-inline" },
                    h("button", {
                        type: "button",
                        className: "gp-btn gp-btn-sm",
                        "data-variant": "ghost",
                        disabled: !enabled,
                        onClick: addRow
                    }, "+ " + t("addCustomCategory"))
                ),
                h("p", { className: "gp-hint gp-hint-block" }, t("safetyLegend"))
            );
        }

        function RequestSection(props) {
            const model = props.model;
            const errors = props.errors;
            const t = props.t;
            const update = props.update;
            const clear = props.clear;
            const modeError = errors.mode;
            const timeoutError = errors.serverTimeoutSeconds;
            const unsupportedError = errors.onUnsupportedBody;
            const debugError = errors.debugDumpTo;
            const modeHint = model.mode === "replace" ? t("modeReplace") : model.mode === "insert-only" ? t("modeInsertOnly") : t("modeMerge");
            return h("div", { className: "gp-section" },
                h("div", { className: "gp-section-head" },
                    h("div", { className: "gp-card-title" }, t("sectionRequest")),
                    h("p", { className: "gp-card-desc" }, t("sectionRequestDesc"))
                ),
                h("div", { className: "gp-grid" },
                    h(Field, {
                        label: h("span", { className: "gp-mono" }, t("fieldMode")),
                        hint: modeHint,
                        error: modeError,
                        htmlFor: "gp-mode"
                    },
                        h("select", {
                            id: "gp-mode",
                            className: "gp-select gp-mono",
                            value: model.mode,
                            "data-invalid": modeError ? "true" : "false",
                            onChange: (event) => {
                                clear("mode");
                                update({ mode: event.currentTarget.value });
                            }
                        },
                            VALID_MODES.map((mode) => h("option", { value: mode, key: mode }, mode))
                        )
                    ),
                    h(Field, {
                        label: h("span", { className: "gp-mono" }, t("fieldTimeout")),
                        hint: t("timeoutHint"),
                        error: timeoutError,
                        htmlFor: "gp-timeout-enabled"
                    },
                        h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
                            h("label", { className: "gp-switch", style: { fontWeight: 400 } },
                                h("input", {
                                    id: "gp-timeout-enabled",
                                    type: "checkbox",
                                    checked: model.timeoutEnabled === true,
                                    onChange: (event) => {
                                        clear("serverTimeoutSeconds");
                                        update({ timeoutEnabled: event.currentTarget.checked });
                                    }
                                }),
                                h("span", null, t("timeoutEnable"))
                            ),
                            h("input", {
                                className: "gp-input gp-mono",
                                type: "text",
                                inputMode: "numeric",
                                value: model.timeoutText,
                                disabled: model.timeoutEnabled !== true,
                                spellCheck: false,
                                "aria-label": t("fieldTimeout"),
                                "data-invalid": timeoutError ? "true" : "false",
                                onChange: (event) => {
                                    clear("serverTimeoutSeconds");
                                    update({ timeoutText: event.currentTarget.value });
                                }
                            })
                        )
                    ),
                    h(Field, {
                        label: h("span", { className: "gp-mono" }, t("fieldUnsupported")),
                        hint: t("hint_onUnsupportedBody"),
                        error: unsupportedError,
                        htmlFor: "gp-unsupported"
                    },
                        h("select", {
                            id: "gp-unsupported",
                            className: "gp-select gp-mono",
                            value: model.onUnsupportedBody,
                            "data-invalid": unsupportedError ? "true" : "false",
                            onChange: (event) => {
                                clear("onUnsupportedBody");
                                update({ onUnsupportedBody: event.currentTarget.value });
                            }
                        },
                            VALID_BODY_POLICIES.map((policy) => h("option", { key: policy, value: policy }, policy === "skip" ? t("unsupportedSkip") : t("unsupportedError")))
                        )
                    ),
                    h(Field, {
                        label: h("span", { className: "gp-mono" }, t("fieldLog")),
                        hint: t("logLabel"),
                        htmlFor: "gp-log"
                    },
                        h("label", { className: "gp-switch", style: { fontWeight: 400 } },
                            h("input", {
                                id: "gp-log",
                                type: "checkbox",
                                checked: model.log === true,
                                onChange: (event) => {
                                    clear("log");
                                    update({ log: event.currentTarget.checked });
                                }
                            }),
                            h("span", { className: "gp-hint" }, model.log === true ? t("valueLogOn") : t("valueLogOff"))
                        )
                    ),
                    h(Field, {
                        label: h("span", { className: "gp-mono" }, t("fieldDebug")),
                        hint: t("debugHint"),
                        error: debugError,
                        htmlFor: "gp-debug"
                    },
                        h("input", {
                            id: "gp-debug",
                            className: "gp-input gp-mono",
                            type: "text",
                            value: model.debugDumpTo,
                            placeholder: "C:\\path\\dump.jsonl",
                            spellCheck: false,
                            "data-invalid": debugError ? "true" : "false",
                            onChange: (event) => {
                                clear("debugDumpTo");
                                update({ debugDumpTo: event.currentTarget.value });
                            }
                        })
                    )
                )
            );
        }

        function GenField(props) {
            const field = props.field;
            const model = props.model;
            const t = props.t;
            const path = "officialParams.generationConfig." + field.key;
            const error = props.errors[path];
            const id = domId(path);
            const raw = model.gen[field.key];
            const value = raw === undefined || raw === null ? "" : raw;
            const label = h("span", { className: "gp-mono" }, field.key);
            const hint = t("hint_" + field.key);
            if (field.kind === "bool") {
                return h(Field, { label, hint, error, htmlFor: id },
                    h("select", {
                        id,
                        className: "gp-select",
                        value,
                        "data-invalid": error ? "true" : "false",
                        onChange: (event) => props.setGen(field.key, event.currentTarget.value)
                    },
                        h("option", { value: "" }, t("boolUnset")),
                        h("option", { value: "true" }, t("boolTrue")),
                        h("option", { value: "false" }, t("boolFalse"))
                    )
                );
            }
            if (field.kind === "json") {
                return h(Field, { label, hint, error, span: "full", htmlFor: id },
                    h(JsonArea, {
                        id,
                        value,
                        error,
                        t,
                        onChange: (text) => props.onJsonChange("gen." + field.key, text, path, field.expect)
                    })
                );
            }
            return h(Field, { label, hint, error, htmlFor: id },
                h("input", {
                    id,
                    className: "gp-input gp-mono",
                    type: "text",
                    inputMode: field.kind === "number" || field.kind === "int" ? "decimal" : undefined,
                    value,
                    spellCheck: false,
                    "data-invalid": error ? "true" : "false",
                    onChange: (event) => props.setGen(field.key, event.currentTarget.value)
                })
            );
        }

        function OfficialSection(props) {
            const model = props.model;
            const errors = props.errors;
            const t = props.t;
            const update = props.update;
            const clear = props.clear;
            const setField = (key, value) => {
                clear("officialParams." + key);
                update({ [key]: value });
            };
            const setGen = props.updateGen;
            const tierError = errors["officialParams.serviceTier"];
            const cachedError = errors["officialParams.cachedContent"];
            const labelsError = errors["officialParams.labels"];
            const toolConfigError = errors["officialParams.toolConfig"];
            return h("div", { className: "gp-section" },
                h("div", { className: "gp-section-head" },
                    h("div", { className: "gp-card-title" }, t("sectionOfficial")),
                    h("p", { className: "gp-card-desc" }, t("sectionOfficialDesc"))
                ),
                h("div", { className: "gp-grid" },
                    h(Field, {
                        label: h("span", { className: "gp-mono" }, t("fieldServiceTier")),
                        hint: t("hint_serviceTier"),
                        error: tierError,
                        htmlFor: "gp-service-tier"
                    },
                        h("select", {
                            id: "gp-service-tier",
                            className: "gp-select gp-mono",
                            value: model.serviceTier,
                            "data-invalid": tierError ? "true" : "false",
                            onChange: (event) => setField("serviceTier", event.currentTarget.value)
                        },
                            h("option", { value: "" }, t("tierUnset")),
                            VALID_TIERS.map((tier) => h("option", { key: tier, value: tier }, tier))
                        )
                    ),
                    h(Field, {
                        label: h("span", { className: "gp-mono" }, t("fieldCachedContent")),
                        hint: t("hint_cachedContent"),
                        error: cachedError,
                        htmlFor: "gp-cached-content"
                    },
                        h("input", {
                            id: "gp-cached-content",
                            className: "gp-input gp-mono",
                            type: "text",
                            value: model.cachedContent,
                            placeholder: "cachedContents/…",
                            spellCheck: false,
                            "data-invalid": cachedError ? "true" : "false",
                            onChange: (event) => setField("cachedContent", event.currentTarget.value)
                        })
                    )
                ),
                h("div", { className: "gp-grid", style: { marginTop: "12px" } },
                    h(Field, {
                        label: h("span", { className: "gp-mono" }, t("fieldLabels")),
                        hint: t("hint_labels"),
                        error: labelsError,
                        span: "full",
                        htmlFor: "gp-labels"
                    },
                        h(JsonArea, {
                            id: "gp-labels",
                            value: model.labelsText,
                            error: labelsError,
                            t,
                            rows: 4,
                            onChange: (text) => props.onJsonChange("labelsText", text, "officialParams.labels", "object")
                        })
                    ),
                    h(Field, {
                        label: h("span", { className: "gp-mono" }, t("fieldToolConfig")),
                        hint: t("hint_toolConfig"),
                        error: toolConfigError,
                        span: "full",
                        htmlFor: "gp-tool-config"
                    },
                        h(JsonArea, {
                            id: "gp-tool-config",
                            value: model.toolConfigText,
                            error: toolConfigError,
                            t,
                            rows: 5,
                            onChange: (text) => props.onJsonChange("toolConfigText", text, "officialParams.toolConfig", "object")
                        })
                    )
                ),
                h("div", { className: "gp-subhead" }, "generationConfig"),
                h("p", { className: "gp-hint", style: { margin: "0 0 10px" } }, t("sectionGenDesc")),
                GEN_GROUPS.map((group) => h("div", { className: "gp-group", key: group.id },
                    h("div", { className: "gp-group-title" }, t(group.labelKey)),
                    h("div", { className: "gp-grid" },
                        GEN_FIELDS.filter((field) => field.group === group.id).map((field) => h(GenField, {
                            key: field.key,
                            field,
                            model,
                            errors,
                            t,
                            setGen,
                            onJsonChange: props.onJsonChange
                        }))
                    )
                ))
            );
        }

        // ── 配置页（插件详情页内） ───────────────────────────────────────────
        function GeminiParameterConfigPage(props) {
            const localeT = typeof props.t === "function" ? props.t : (key) => key;
            const tr = (key, params) => {
                const value = localeT(key);
                const fallback = typeof value === "string" && value !== "" ? value : (en[key] !== undefined ? en[key] : key);
                return fill(fallback, params);
            };
            // 槽的 inject 正常一定给齐四个方法；这里仍逐个兜底，避免宿主漏注时
            // 在 effect 里抛同步异常把整页打挂（只会显示一条错误）。
            const faceMethod = (name) => (
                typeof props[name] === "function"
                    ? props[name]
                    : () => Promise.reject(new Error(tr("errRemoteMissing")))
            );
            const loadInfo = faceMethod("loadInfo");
            const saveConfig = faceMethod("saveConfig");
            const resetDefaults = faceMethod("resetDefaults");
            const revealConfigFile = faceMethod("revealConfigFile");

            const [info, setInfo] = react.useState(null);
            const [loading, setLoading] = react.useState(true);
            const [loadError, setLoadError] = react.useState(null);
            const [stage, setStage] = react.useState("view");
            const [model, setModel] = react.useState(null);
            const [baseline, setBaseline] = react.useState("");
            const [fieldErrors, setFieldErrors] = react.useState({});
            const [formError, setFormError] = react.useState(null);
            const [banner, setBanner] = react.useState(null);
            const [busy, setBusy] = react.useState(null);
            const [confirm, setConfirm] = react.useState(null);

            const pickConfig = (value) => {
                if (value === null || value === undefined) return {};
                if (isPlainObject(value.fileConfig)) return value.fileConfig;
                if (isPlainObject(value.activeConfig)) return value.activeConfig;
                return {};
            };

            const applyInfo = (value) => {
                const next = configToModel(pickConfig(value));
                setInfo(value);
                setLoadError(null);
                setModel(next);
                setBaseline(JSON.stringify(next));
                setFieldErrors({});
                setFormError(null);
            };

            /** 读取宿主信息。silent 只用于首次挂载（错误由空态卡片呈现）。 */
            const refresh = async (options) => {
                const silent = isPlainObject(options) && options.silent === true;
                setBusy("reload");
                try {
                    const value = await loadInfo();
                    if (!isPlainObject(value)) throw new Error(tr("noInfo"));
                    applyInfo(value);
                    return value;
                } catch (error) {
                    setLoadError(errorFull(error));
                    if (!silent) {
                        setBanner({ tone: "error", title: tr("loadFailed"), lines: [errorFull(error)] });
                    }
                    throw error;
                } finally {
                    setBusy(null);
                    setLoading(false);
                }
            };

            react.useEffect(() => {
                let alive = true;
                setBusy("reload");
                loadInfo().then((value) => {
                    if (!alive) return;
                    if (!isPlainObject(value)) throw new Error(tr("noInfo"));
                    applyInfo(value);
                }).catch((error) => {
                    if (!alive) return;
                    setLoadError(errorFull(error));
                }).finally(() => {
                    if (!alive) return;
                    setBusy(null);
                    setLoading(false);
                });
                return () => {
                    alive = false;
                };
            }, []);

            const clearErrors = (prefix) => {
                setFieldErrors((previous) => {
                    const doomed = Object.keys(previous).filter((key) => key === prefix || key.indexOf(prefix + ".") === 0);
                    if (doomed.length === 0) return previous;
                    const next = {};
                    for (const key of Object.keys(previous)) {
                        if (doomed.indexOf(key) === -1) next[key] = previous[key];
                    }
                    return next;
                });
            };

            const update = (patch, clearPrefix) => {
                setModel((previous) => (previous === null ? previous : { ...previous, ...patch }));
                if (typeof clearPrefix === "string" && clearPrefix !== "") clearErrors(clearPrefix);
            };

            // 用函数式更新读「最新」model：同一 tick 内连续多处编辑时不会互相覆盖。
            const updateRows = (key, mapper, clearPrefix) => {
                setModel((previous) => {
                    if (previous === null) return previous;
                    const rows = Array.isArray(previous[key]) ? previous[key] : [];
                    return { ...previous, [key]: mapper(rows) };
                });
                if (typeof clearPrefix === "string" && clearPrefix !== "") clearErrors(clearPrefix);
            };

            const updateGen = (key, value) => {
                setModel((previous) => (previous === null ? previous : { ...previous, gen: { ...previous.gen, [key]: value } }));
                clearErrors("officialParams.generationConfig." + key);
            };

            const onJsonChange = (key, text, path, expect) => {
                if (key.indexOf("gen.") === 0) {
                    const field = key.slice(4);
                    setModel((previous) => (previous === null ? previous : { ...previous, gen: { ...previous.gen, [field]: text } }));
                } else {
                    setModel((previous) => (previous === null ? previous : { ...previous, [key]: text }));
                }
                const parsed = parseJsonText(text, expect, tr);
                setFieldErrors((previous) => {
                    if (parsed.state === "error") {
                        const next = { ...previous };
                        next[path] = parsed.message;
                        return next;
                    }
                    if (!Object.prototype.hasOwnProperty.call(previous, path)) return previous;
                    const next = { ...previous };
                    delete next[path];
                    return next;
                });
            };

            const dirty = stage === "edit" && model !== null && JSON.stringify(model) !== baseline;

            const startEdit = () => {
                if (info === null) return;
                const next = configToModel(pickConfig(info));
                setModel(next);
                setBaseline(JSON.stringify(next));
                setFieldErrors({});
                setFormError(null);
                setStage("edit");
            };

            const leaveEdit = () => {
                setStage("view");
                setFieldErrors({});
                setFormError(null);
            };

            const cancelEdit = () => {
                if (dirty) setConfirm({ kind: "discard" });
                else leaveEdit();
            };

            const successLines = (value, bodyKey) => {
                const lines = [tr(bodyKey)];
                if (value !== null && typeof value === "object" && typeof value.backupFile === "string" && value.backupFile !== "") {
                    lines.push(tr("backupFile", { path: value.backupFile }));
                }
                if (value !== null && typeof value === "object" && Array.isArray(value.warnings) && value.warnings.length > 0) {
                    lines.push(tr("warningsTitle"));
                    for (const warning of value.warnings) lines.push("· " + String(warning));
                }
                lines.push(tr("restartNeeded"));
                return lines;
            };

            const handleSave = async () => {
                if (model === null) return;
                const checked = validateModel(model, tr);
                const count = Object.keys(checked.errors).length;
                if (count > 0) {
                    setFieldErrors(checked.errors);
                    setFormError(tr("errorsSummary", { count }));
                    return;
                }
                setBusy("save");
                setFormError(null);
                setBanner(null);
                let saved = false;
                try {
                    const value = await saveConfig(checked.config);
                    setBanner({ tone: "success", title: tr("saveSuccess"), lines: successLines(value, "saveSuccessBody") });
                    setStage("view");
                    saved = true;
                } catch (error) {
                    setFormError(errorDetail(error));
                    setBanner({ tone: "error", title: tr("actionFailed"), lines: [errorFull(error)] });
                } finally {
                    setBusy(null);
                }
                if (saved) {
                    try {
                        await refresh();
                    } catch (error) {
                        // refresh 已经把失败写进提示条与 loadError。
                    }
                }
            };

            const handleReset = async () => {
                setBusy("reset");
                setBanner(null);
                setFormError(null);
                let reset = false;
                try {
                    const value = await resetDefaults();
                    setBanner({ tone: "success", title: tr("actionReset"), lines: successLines(value, "resetSuccessBody") });
                    setStage("view");
                    reset = true;
                } catch (error) {
                    setFormError(errorDetail(error));
                    setBanner({ tone: "error", title: tr("actionFailed"), lines: [errorFull(error)] });
                } finally {
                    setBusy(null);
                }
                if (reset) {
                    try {
                        await refresh();
                    } catch (error) {
                        // 同上：refresh 自己负责显示错误。
                    }
                }
            };

            const handleReveal = async () => {
                setBusy("reveal");
                try {
                    const value = await revealConfigFile();
                    const path = value !== null && typeof value === "object" && typeof value.path === "string" ? value.path : "";
                    setBanner({ tone: "success", title: tr("revealSuccess"), lines: path === "" ? [] : [path] });
                } catch (error) {
                    setBanner({ tone: "error", title: tr("actionFailed"), lines: [errorFull(error)] });
                } finally {
                    setBusy(null);
                }
            };

            const doReload = async () => {
                try {
                    await refresh();
                    setBanner({ tone: "info", title: tr("reloadSuccess"), lines: [] });
                } catch (error) {
                    // refresh 已经显示错误。
                }
            };

            const requestReload = () => {
                if (dirty) setConfirm({ kind: "reload" });
                else void doReload();
            };

            const runConfirm = () => {
                if (confirm === null) return;
                const kind = confirm.kind;
                setConfirm(null);
                if (kind === "reset") void handleReset();
                else if (kind === "discard") leaveEdit();
                else if (kind === "reload") void doReload();
            };

            // ── 渲染工具 ────────────────────────────────────────────────────
            const button = (key, variant, content, onClick, disabled) => h("button", {
                key,
                type: "button",
                className: "gp-btn",
                "data-variant": variant,
                disabled: disabled === true,
                onClick
            }, content);

            const badge = () => {
                if (info === null) return null;
                const needsRestart = info.needsRestart === true || info.differsFromActive === true;
                const label = needsRestart ? tr("badgeWarn") : tr("badgeOk");
                return h("span", { className: "gp-badge", "data-tone": needsRestart ? "warn" : "ok", title: label }, label);
            };

            const renderHeader = () => {
                const version = info !== null && typeof info.version === "string" && info.version !== "" ? info.version : FALLBACK_VERSION;
                const actions = [];
                if (stage === "edit") {
                    actions.push(button("hdr-reload", "ghost", [h(RefreshGlyph, { key: "icon", size: 13 }), h("span", { key: "label" }, busy === "reload" ? tr("busyReload") : tr("actionReload"))], requestReload, busy !== null));
                    actions.push(button("hdr-cancel", "ghost", tr("actionCancel"), cancelEdit, busy !== null));
                    actions.push(button("hdr-save", "primary", busy === "save" ? tr("busySave") : tr("actionSave"), () => { void handleSave(); }, busy !== null || model === null));
                } else {
                    actions.push(button("hdr-reveal", "ghost", [h(FolderGlyph, { key: "icon", size: 13 }), h("span", { key: "label" }, busy === "reveal" ? tr("busyReveal") : tr("actionReveal"))], () => { void handleReveal(); }, busy !== null));
                    actions.push(button("hdr-reload", "ghost", [h(RefreshGlyph, { key: "icon", size: 13 }), h("span", { key: "label" }, busy === "reload" ? tr("busyReload") : tr("actionReload"))], requestReload, busy !== null));
                    actions.push(button("hdr-reset", "danger", busy === "reset" ? tr("busyReset") : tr("actionReset"), () => setConfirm({ kind: "reset" }), busy !== null));
                    actions.push(button("hdr-edit", "primary", tr("editButton"), startEdit, busy !== null || info === null));
                }
                return h("div", { className: "gp-head" },
                    h("div", { className: "gp-head-main" },
                        h("div", { className: "gp-title-row" },
                            h("h2", { className: "gp-title" }, tr("title")),
                            badge(),
                            stage === "edit" && dirty ? h("span", { className: "gp-tag", "data-tone": "warn" }, tr("unsaved")) : null,
                            h("span", { className: "gp-ver", title: tr("versionLabel") }, "v" + version)
                        ),
                        h("p", { className: "gp-sub" }, tr("subtitle"))
                    ),
                    h("div", { className: "gp-head-actions" }, actions)
                );
            };

            const renderBanner = () => {
                if (banner === null) return null;
                return h("div", {
                    className: "gp-banner",
                    "data-tone": banner.tone,
                    role: banner.tone === "error" ? "alert" : "status"
                },
                    h("div", { className: "gp-banner-main" },
                        h("p", { className: "gp-banner-title" }, banner.title),
                        Array.isArray(banner.lines) && banner.lines.length > 0
                            ? h("p", { className: "gp-banner-body" }, banner.lines.join("\n"))
                            : null
                    ),
                    h("button", {
                        type: "button",
                        className: "gp-banner-close",
                        title: tr("dismiss"),
                        "aria-label": tr("dismiss"),
                        onClick: () => setBanner(null)
                    }, "×")
                );
            };

            const renderFileCard = () => {
                const path = info !== null && typeof info.configFile === "string" && info.configFile !== "" ? info.configFile : "";
                const meta = [];
                if (info !== null && typeof info.fileMtimeIso === "string" && info.fileMtimeIso !== "") {
                    meta.push(tr("fileMtimeLabel") + "：" + formatTimestamp(info.fileMtimeIso));
                }
                if (info !== null && typeof info.hostBootIso === "string" && info.hostBootIso !== "") {
                    meta.push(tr("bootLabel") + "：" + formatTimestamp(info.hostBootIso));
                }
                const fileConfig = info !== null && isPlainObject(info.fileConfig) ? info.fileConfig : null;
                return h("div", { className: "gp-card", "data-tone": "notice" },
                    h("div", { className: "gp-card-title" }, tr("fileCardTitle")),
                    h("p", { className: "gp-card-desc" }, tr("fileCardBody")),
                    path !== "" ? h("div", { className: "gp-path" }, path) : null,
                    h("p", { className: "gp-hint gp-hint-block" }, tr("fileCardWarn", { profile: PROFILE_PATCH_EXAMPLE })),
                    info !== null && info.fileExists === false
                        ? h("p", { className: "gp-hint gp-hint-block gp-warn-text" }, tr("fileMissing"))
                        : null,
                    info !== null && info.readError !== null && info.readError !== undefined && info.readError !== ""
                        ? h("div", { className: "gp-banner", "data-tone": "error", style: { marginTop: "9px" } },
                            h("div", { className: "gp-banner-main" },
                                h("p", { className: "gp-banner-title" }, tr("loadFailed")),
                                h("p", { className: "gp-banner-body" }, tr("fileReadError", { message: String(info.readError) }))
                            )
                        )
                        : null,
                    meta.length > 0 ? h("p", { className: "gp-meta" }, meta.join("  ·  ")) : null,
                    info !== null && info.fileChangedSinceBoot === true && info.differsFromActive !== true
                        ? h("p", { className: "gp-hint gp-hint-block" }, tr("fileChangedNote"))
                        : null,
                    fileConfig !== null && info.differsFromActive === true
                        ? h("details", { className: "gp-details" },
                            h("summary", null, tr("fileDiffTitle")),
                            h("p", { className: "gp-hint" }, tr("fileDiffDesc")),
                            h("pre", { className: "gp-pre" }, safeStringify(fileConfig))
                        )
                        : null
                );
            };

            const renderLoading = () => h("div", { className: "gp-card" },
                h("div", { className: "gp-loading" },
                    h("span", { className: "gp-spinner" }),
                    h("span", null, tr("loading"))
                )
            );

            const renderLoadError = () => h("div", { className: "gp-card", "data-tone": "error" },
                h("div", { className: "gp-card-title" }, tr("loadFailed")),
                h("p", { className: "gp-error gp-hint-block", role: "alert" }, loadError === null ? tr("noInfo") : String(loadError)),
                h("div", { className: "gp-row-inline", style: { marginTop: "10px" } },
                    button("retry", "primary", busy === "reload" ? tr("busyReload") : tr("retry"), () => { void refresh(); }, busy !== null)
                )
            );

            const renderOverview = () => {
                const active = isPlainObject(info.activeConfig) ? info.activeConfig : pickConfig(info);
                const stats = isPlainObject(info.stats) ? info.stats : {};
                const hosts = Array.isArray(active.hosts) ? active.hosts.map((value) => String(value)) : [];
                const endpoints = Array.isArray(active.endpoints) ? active.endpoints.map((value) => String(value)) : [];
                const relayOff = !Array.isArray(active.relayUnwrap) || active.relayUnwrap.length === 0;
                const relayPrefixes = Array.isArray(active.relayUnwrap) ? active.relayUnwrap.map((value) => String(value)) : [];
                const relaySpotted = typeof stats.relaySpotted === "number" && Number.isFinite(stats.relaySpotted) ? stats.relaySpotted : 0;
                const relayWarning = relayOff && relaySpotted > 0
                    ? h("div", { className: "gp-card", "data-tone": "warn", role: "alert" },
                        h("div", { className: "gp-card-title" }, tr("relayWarnTitle")),
                        h("p", { className: "gp-card-desc" }, tr("relayWarnBody", { count: relaySpotted }))
                    )
                    : null;
                const timeout = active.serverTimeoutSeconds;
                const kvRows = [];
                const addRow = (key, label, value) => {
                    kvRows.push(h("div", { className: "gp-k", key: key + "-k" }, label));
                    kvRows.push(h("div", { className: "gp-v", key: key + "-v" }, value));
                };
                const chips = (values, prefix) => values.length === 0
                    ? h("span", { className: "gp-hint" }, "—")
                    : h("div", null, values.map((value, index) => h("span", { className: "gp-chip", key: prefix + "-" + index }, value)));

                addRow("hosts", tr("labelHosts"), chips(hosts, "host"));
                addRow("endpoints", tr("labelEndpoints"), chips(endpoints, "endpoint"));
                addRow("relay", tr("labelRelay"),
                    relayOff
                        ? h("span", { className: "gp-hint" }, tr("valueRelayOff"))
                        : h("div", null,
                            relayPrefixes.map((prefix, index) => {
                                const target = KNOWN_RELAY_TARGETS[prefix];
                                return h("span", { key: "relay-" + index },
                                    h("span", { className: "gp-chip" }, prefix),
                                    target === undefined
                                        ? null
                                        : h("span", { className: "gp-hint" }, tr("relayCompatWith", { plugin: target }))
                                );
                            }),
                            h("div", { className: "gp-hint" }, tr("relayPurposeHint"))
                        ));
                addRow("mode", tr("labelMode"), tr(active.mode === "replace" ? "modeReplace" : active.mode === "insert-only" ? "modeInsertOnly" : "modeMerge"));
                addRow("safety", tr("labelSafety"), h(SafetySettingsView, { value: active.safetySettings, t: tr }));
                addRow("timeout", tr("labelTimeout"),
                    typeof timeout === "number" && timeout > 0
                        ? tr("valueTimeoutOn", { seconds: timeout })
                        : h("span", { className: "gp-hint" }, tr("valueTimeoutOff")));
                addRow("official", tr("labelOfficial"), h(OfficialParamsView, { value: active.officialParams, t: tr }));
                addRow("debug", tr("labelDebug"),
                    typeof active.debugDumpTo === "string" && active.debugDumpTo !== ""
                        ? h("span", { className: "gp-mono" }, active.debugDumpTo)
                        : h("span", { className: "gp-hint" }, tr("valueDebugOff")));
                addRow("log", tr("labelLog"), h("span", { className: "gp-hint" }, active.log === true ? tr("valueLogOn") : tr("valueLogOff")));
                addRow("unsupported", tr("labelUnsupported"), tr(active.onUnsupportedBody === "error" ? "unsupportedError" : "unsupportedSkip"));

                return h("div", { className: "gp-card" },
                    h("div", { className: "gp-card-title" }, tr("overviewTitle")),
                    h("p", { className: "gp-card-desc" }, tr("overviewDesc")),
                    relayWarning,
                    h("div", { className: "gp-kv" }, kvRows),
                    h("div", { className: "gp-block" },
                        h("div", { className: "gp-card-title" }, tr("labelStats")),
                        h("div", { className: "gp-stats" },
                            STAT_FIELDS.map((field) => {
                                const numeric = stats[field.key];
                                return h("div", { className: "gp-stat", key: field.key },
                                    h("div", { className: "gp-stat-num" }, typeof numeric === "number" && Number.isFinite(numeric) ? String(numeric) : "0"),
                                    h("div", { className: "gp-stat-label" }, tr(field.labelKey))
                                );
                            })
                        )
                    )
                );
            };

            const renderEditor = () => {
                if (model === null) return null;
                const checked = validateModel(model, tr);
                return h("div", { className: "gp-card" },
                    h("div", { className: "gp-card-head" },
                        h("div", { className: "gp-card-title" }, tr("editTitle")),
                        h("p", { className: "gp-card-desc" }, tr("editDesc"))
                    ),
                    formError !== null && formError !== ""
                        ? h("div", { className: "gp-banner", "data-tone": "error", style: { marginTop: "10px" }, role: "alert" },
                            h("div", { className: "gp-banner-main" },
                                h("p", { className: "gp-banner-title" }, tr("actionFailed")),
                                h("p", { className: "gp-banner-body" }, formError)
                            )
                        )
                        : null,
                    h(NetworkSection, {
                        model,
                        errors: fieldErrors,
                        t: tr,
                        update,
                        updateRows,
                        clear: clearErrors
                    }),
                    h(SafetySection, {
                        model,
                        errors: fieldErrors,
                        t: tr,
                        update,
                        updateRows,
                        clear: clearErrors
                    }),
                    h(RequestSection, {
                        model,
                        errors: fieldErrors,
                        t: tr,
                        update,
                        clear: clearErrors
                    }),
                    h(OfficialSection, {
                        model,
                        errors: fieldErrors,
                        t: tr,
                        update,
                        updateRows,
                        updateGen,
                        clear: clearErrors,
                        onJsonChange
                    }),
                    h("details", { className: "gp-details" },
                        h("summary", null, tr("previewTitle")),
                        h("p", { className: "gp-hint" }, tr("previewDesc")),
                        h("pre", { className: "gp-pre" }, safeStringify(checked.config))
                    ),
                    // 表单很长：底部再放一次保存/取消，避免填完还要滚回顶部。
                    h("div", { className: "gp-actions" },
                        button("foot-save", "primary", busy === "save" ? tr("busySave") : tr("actionSave"), () => { void handleSave(); }, busy !== null),
                        button("foot-cancel", "ghost", tr("actionCancel"), cancelEdit, busy !== null),
                        h("div", { className: "gp-actions-spacer" }),
                        Object.keys(fieldErrors).length > 0
                            ? h("span", { className: "gp-hint" }, tr("errorsSummary", { count: Object.keys(fieldErrors).length }))
                            : null
                    )
                );
            };

            const confirmLabels = () => {
                if (confirm === null) return null;
                if (confirm.kind === "reset") {
                    return { title: tr("confirmResetTitle"), body: tr("confirmResetBody") };
                }
                if (confirm.kind === "discard") {
                    return { title: tr("confirmDiscardTitle"), body: tr("confirmDiscardBody") };
                }
                return { title: tr("confirmReloadTitle"), body: tr("confirmReloadBody") };
            };

            const dialogLabels = confirmLabels();

            return h("div", { className: "gp-root", "data-view": stage },
                renderHeader(),
                renderBanner(),
                loading && info === null ? renderLoading() : null,
                !loading && info === null ? renderLoadError() : null,
                info !== null ? renderFileCard() : null,
                // 浏览态给「当前生效配置」概览，编辑态直接接编辑表单：避免点完
                // 顶部「编辑配置」还要滚过整张概览才看见表单。
                stage === "view" && info !== null ? renderOverview() : null,
                stage === "edit" ? renderEditor() : null,
                dialogLabels !== null
                    ? h(ConfirmDialog, {
                        title: dialogLabels.title,
                        body: dialogLabels.body,
                        confirmLabel: tr("confirmOk"),
                        cancelLabel: tr("confirmCancel"),
                        tone: confirm.kind === "reset" ? "danger" : "primary",
                        busy: busy !== null,
                        onConfirm: runConfirm,
                        onCancel: () => setConfirm(null)
                    })
                    : null
            );
        }

        /**
         * 槽组件入口：插件详情页的配置区传 view:"page"；官方插件列表/卡片用
         * view:"summary" 取一行弱化摘要。摘要不需要远端数据，只写能力一句话。
         */
        function GeminiParameterConfig(props) {
            const localeT = typeof props.t === "function" ? props.t : (key) => key;
            if (props.view === "summary") {
                const value = localeT("summary");
                const text = typeof value === "string" && value !== "" ? value : (zh.summary !== undefined ? zh.summary : "Gemini parameters");
                return h("span", { className: "gp-summary" }, text);
            }
            return h(GeminiParameterConfigPage, props);
        }

        // ── 远程贡献描述符 ───────────────────────────────────────────────────
        // 客户端 codec：严格校验由服务端 manifest 承担，这里用恒等 codec 直通
        // （与参考插件的 identity / strictSchema 写法同形）。
        const identity = (value) => value;
        const strictSchema = { parse: identity };
        const codec = (symbol) => ({ mode: "strict", typeSymbol: symbol, create: () => strictSchema });

        const CONTRIBUTION = {
            package: PACKAGE_NAME,
            descriptors: [
                {
                    id: PACKAGE_NAME + "#" + SERVICE + "/getInfo",
                    service: SERVICE,
                    namespace: SERVICE,
                    method: "getInfo",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec(PACKAGE_NAME + "#GeminiParameterInfo")
                },
                {
                    id: PACKAGE_NAME + "#" + SERVICE + "/saveConfig",
                    service: SERVICE,
                    namespace: SERVICE,
                    method: "saveConfig",
                    invocation: { kind: "direct" },
                    parameters: [
                        {
                            name: "config",
                            wire: "config",
                            source: "json",
                            codec: codec(PACKAGE_NAME + "#GeminiParameterConfig")
                        }
                    ],
                    result: codec(PACKAGE_NAME + "#GeminiParameterSaveResult")
                },
                {
                    id: PACKAGE_NAME + "#" + SERVICE + "/resetDefaults",
                    service: SERVICE,
                    namespace: SERVICE,
                    method: "resetDefaults",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec(PACKAGE_NAME + "#GeminiParameterSaveResult")
                },
                {
                    id: PACKAGE_NAME + "#" + SERVICE + "/revealConfigFile",
                    service: SERVICE,
                    namespace: SERVICE,
                    method: "revealConfigFile",
                    invocation: { kind: "direct" },
                    parameters: [],
                    result: codec(PACKAGE_NAME + "#GeminiParameterRevealResult")
                }
            ]
        };

        // ── cordis 插件体 ────────────────────────────────────────────────────
        const inject = ["slots", "locale", "remote"];

        function apply(ctx) {
            // 字典注册（生命周期随插件 fiber）
            ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-gemini-parameter: dictionaries");
            const t = ctx.locale.bind(NS);
            // 先挂载远程贡献；每次调用都等挂载完成后再取命名空间服务。
            const mount = ctx.remote.$mount(CONTRIBUTION);

            const callRemote = async (method, ...args) => {
                await mount;
                const remote = ctx.get("remote." + SERVICE);
                if (remote === null || typeof remote !== "object") {
                    throw new Error(t("errRemoteMissing"));
                }
                const result = await remote[method](...args);
                if (result === null || typeof result !== "object" || result.ok !== true) {
                    throw remoteError(method, result !== null && typeof result === "object" ? result.error : result);
                }
                const value = result.value;
                // 兼容「RPC 成功但 value 自身带 ok:false」的返回形态。
                if (value !== null && typeof value === "object" && value.ok === false && value.error !== undefined) {
                    throw remoteError(method, value.error);
                }
                return value;
            };

            const face = () => ({
                t,
                loadInfo: () => callRemote("getInfo"),
                saveConfig: (config) => callRemote("saveConfig", config),
                resetDefaults: () => callRemote("resetDefaults"),
                revealConfigFile: () => callRemote("revealConfigFile")
            });

            // 唯一注册：插件详情页配置区。key 必须是包名，宿主据此把本插件标成
            // 「有配置」并在详情里渲染本组件。不再注册 sidebar.panellist / main /
            // settings.section / shell.overlay。
            ctx.slots.inject(CONFIG_SLOT, () => {
                const reg = ctx.slots.register({
                    name: CONFIG_SLOT,
                    key: PACKAGE_NAME,
                    locale: NS,
                    inject: face
                }, GeminiParameterConfig);
                return () => {
                    if (typeof reg === "function") reg();
                };
            });
        }

        bundleModule.exports.NS = NS;
        bundleModule.exports.apply = apply;
        bundleModule.exports.inject = inject;
        // 本地回归脚本用：不参与宿主行为，只是把纯函数与字典暴露给 node 侧的 smoke test。
        bundleModule.exports.__internals = { zh, en, configToModel, validateModel, GEN_FIELDS };
        return bundleModule.exports;
    }
});
