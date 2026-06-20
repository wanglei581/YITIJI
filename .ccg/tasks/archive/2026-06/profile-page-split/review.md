# ProfilePage 结构拆分审查

## 本地验证

- `pnpm --filter @ai-job-print/kiosk typecheck`：通过。
- `pnpm --filter @ai-job-print/kiosk lint`：通过；仅存在既有 `KioskBusyContext.tsx` Fast Refresh warning。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`：通过。
- `curl -I http://127.0.0.1:5173/profile`：200 OK。

## 双模型审查

- Claude：APPROVE。无 Critical / Warning；确认入口数据、toast、本次服务记录、登录头部、合规说明和可访问性属性保持等价。
- Antigravity：APPROVE。无 Critical / Warning；确认 `ProfilePage` 拆分为类型、配置和组件后没有行为变化，`AI服务记录` 入口仍保留 `/assistant`。

## 结果

`ProfilePage.tsx` 从 595 行降到 177 行。本分支只做结构拆分，不修改入口、路由、文案、后端 API 或业务行为。
