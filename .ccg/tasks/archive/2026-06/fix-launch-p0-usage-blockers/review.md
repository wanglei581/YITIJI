# Review: fix-launch-p0-usage-blockers

日期：2026-06-15

## 本地验证

- `pnpm --filter @ai-job-print/kiosk verify:scan-production-guard`：通过
- `pnpm --filter terminal-agent verify:printer-config`：通过
- `pnpm --filter @ai-job-print/kiosk typecheck`：通过
- `pnpm --filter terminal-agent typecheck`：通过
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`：通过
- `pnpm --filter terminal-agent build`：通过
- `pnpm --filter @ai-job-print/kiosk lint`：0 error，保留既有 `KioskBusyContext` Fast Refresh warning

## 外部审查

- antigravity：调用失败，本机 `agy` 不在 PATH。
- Claude reviewer：通过，无 Critical。

Claude reviewer 提出 2 个 Warning：

1. `agentVersion` 不应成为启动阻塞项。
   - 已处理：`validateRequiredConfig()` 只强制 `apiBaseUrl`、`terminalCode`、`printerName`。
2. `verify-scan-production-guard.mjs` 多行精确缩进断言过脆。
   - 已处理：改为 token 与相对顺序断言。

另有 Info：直接访问 `/scan/progress` 在 http 模式不应播放完整假扫描动画。

- 已处理：`useEffect` 进入时若 `API_MODE === 'http'` 立即走硬件未接入失败分支。

## 范围说明

本任务只处理：

- Kiosk 扫描生产 http 模式禁模拟成功，入口禁用，进度页快速失败，结果页禁用打印/保存/AI 三个出口。
- Terminal Agent 删除默认打印机硬编码与回退，`printerName` 启动期必填，CLI `print` 必须显式传 `--printer`。

当前工作区中已有的 `design-preview` 路由、截图和 `verify:portrait-preview` 属于既有 21.5 寸首页预览工作，不纳入本次 P0 修复审查范围，也未在本任务中处理。
