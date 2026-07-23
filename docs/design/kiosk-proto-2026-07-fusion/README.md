# Kiosk 8177 / 5299 Fusion Baseline

本目录冻结 2026-07 的 5299-led / 8177-state-complete Kiosk 视觉基线。它只用于设计审查、路由映射和后续迁移验收，不进入生产 Kiosk bundle，也不定义新的生产路由。

## 三层契约

1. `sources/**` 是 immutable evidence。其来源、权威 commit 和 SHA-256 记录在 `SOURCE-MANIFEST.md`；任何派生工作都不得修改、格式化或重写这些字节。
2. 本目录根部的 9 个 HTML 是 derived visual baseline。`index.html`、`14-profile.html`、`77-print-upload.html` 以 5299 的布局与信息架构为准；`76-toolbox-zone.html` 是 8177 / 5299 字节一致的共用主态；`15A-login-error.html`、`22B-me-feedback.html`、`32A-cashier-failed.html`、`34A-scan-offline.html`、`76A-toolbox-empty.html` 以 8177 的流程与异常状态为准。公共样式与脚本继续复用 `../kiosk-proto-2026-07/shared.css` 和 `../kiosk-proto-2026-07/shared.js`。
3. 既有 `../kiosk-proto-2026-07-migration-matrix.md` 仍是唯一的 route-to-screen contract。本目录不另建第二份矩阵；根 HTML 只提供可视证据。

## 融合裁决

- `14-profile.html` 保留 5299 的“我的资产”组合。
- `77-print-upload.html` 保留 5299 的 2×2 组合，但纸质扫描是跳转到 `/scan/start` 的独立导航入口，不是打印上传页中的第四种 tab。
- `76-toolbox-zone.html` 作为 `/toolbox` 主态冻结基准；`76A-toolbox-empty.html` 继续只是同一路由的空态参考。
- 五个 `*A` / `*B` 页面只是现有生产页面的 error、feedback、failure、offline、empty 分支参考，不是新 production routes。
- `sources/**` 与根部派生文件均不得被 `apps/kiosk/src/**` import。

## 入口

- `index.html`：5299 目录组织，加“8177 流程与异常状态”区。
- `14-profile.html`：`/profile` 的 derived baseline。
- `77-print-upload.html`：`/print/upload` 的 derived baseline，扫描入口独立跳转 `/scan/start`。
- `76-toolbox-zone.html`：`/toolbox` 的主态 derived baseline。
- 五个状态参考：`15A-login-error.html`、`22B-me-feedback.html`、`32A-cashier-failed.html`、`34A-scan-offline.html`、`76A-toolbox-empty.html`。
