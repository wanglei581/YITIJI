# Review: unified-kiosk-app-placements

## Scope

统一 Kiosk 应用入口投放到百宝箱与智慧校园：共享应用类型、Admin 上架表单、后端 DTO/normalization/白名单、公开 Kiosk config placement 拆分、智慧校园 fallback 端点、Kiosk 首页渲染与启动方式。

## External review

- Antigravity reviewer: 返回 `APPROVE`，无 Critical。报告中把当前 `window.open(..., '_blank', 'noopener,noreferrer')` 误读为 `window.location.assign`，因此“整页卸载 SPA”结论不按当前代码采纳；外部 H5 在 Windows Kiosk 模式下的可恢复性保留为真机验收项。
- Claude reviewer: 无 Critical，指出 `cleanQrImageUrl` / `cleanRoute` 未拦截反斜杠可能绕过相对路径边界。已修复并补 `verify:terminal-device-config` 用例：`0e` 拒绝反斜杠伪装站内路径，`0f` 拒绝反斜杠伪装二维码相对路径。

## Local review result

- Critical: 无。
- Warning: 外部 H5 的真实 Windows Kiosk 行为仍需真机验收，确认新窗口/外部页不会让终端停留在不可恢复页面。
- Info: `KIOSK_EXTERNAL_APP_ALLOWED_HOSTS` 生产配置必须只填 hostname，不带协议；未配置时外部 H5 和远程二维码 fail-closed。

## Verification

- `pnpm --filter @ai-job-print/shared typecheck`
- `pnpm --filter @ai-job-print/api typecheck`
- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/admin typecheck`
- `pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui`
- `pnpm --filter @ai-job-print/api verify:terminal-device-config`
- `pnpm --filter @ai-job-print/api lint` after standalone `prisma generate` to avoid generated-client race
- `pnpm --filter @ai-job-print/admin lint`
- `pnpm --filter @ai-job-print/kiosk lint` (passes with existing Fast Refresh warnings in `KioskBusyContext.tsx`)
- `pnpm --filter @ai-job-print/api db:pg:sync:check`
- `pnpm --filter @ai-job-print/api exec prisma validate --schema prisma/schema.prisma`
- `pnpm --filter @ai-job-print/api exec prisma validate --schema prisma/postgres/schema.prisma`
- `pnpm --filter @ai-job-print/api build`
- `pnpm --filter @ai-job-print/admin build`
- `pnpm --filter @ai-job-print/kiosk build`
- `git diff --check`

## Production boundary

代码侧闭环已完成；上线前仍需 PostgreSQL 预生产 additive migration、配置 `KIOSK_EXTERNAL_APP_ALLOWED_HOSTS`、Admin 保存真实终端配置、Kiosk 真机刷新展示、Windows Kiosk 外部 H5/二维码可恢复性验收。
