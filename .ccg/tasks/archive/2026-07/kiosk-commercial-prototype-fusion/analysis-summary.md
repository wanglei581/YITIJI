# 只读审计摘要

- 5299 原型目录有 82 个文件；8177 含全部 82 个共同文件并另有 8 个独有文件，共 90 个。
- 82 个共同文件中 79 个完全一致；差异文件是 `index.html`、`14-profile.html`、`77-print-upload.html`。
- 8177 独有 5 个状态页及 `FREEZE.md`、`WAVE-P-CLOSURE.md`、`WAVE-P2-FLOWS.md`。
- 当前正式版本化视觉基线仍为 `docs/design/kiosk-proto-2026-07/`；W0 必须先生成并提交唯一融合基准及 SHA-256 来源清单。
- `14-profile.html` 采用 5299 的“我的资产”语义，与当前生产 `profileEntries.ts` 和正式产品矩阵一致。
- `77-print-upload.html` 采用 5299 的 2×2 布局；文件、手机扫码、U 盘是上传来源，扫描是进入 `/scan/start` 的独立 CTA。
- 当前 `origin/main` 已有 75 屏主题与主要结构，实施方式是逐路由差异收口，不从静态 HTML 重写 React。
- 干净实现落点是 `codex/kiosk-8177-5299-fusion-design-20260723` 工作树；旧脏工作区不得作为实现基线。
