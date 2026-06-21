# 防止 Kiosk AI 助手数字人因配置缺失消失

## 目标

- 防止 `/assistant` 在生产构建时，因为漏配 `VITE_USE_TRTC_CALL=true` 而静默回落为文字助手。
- 将问题前移到构建/验证阶段失败，而不是上线后由用户发现页面消失。
- 保留文字助手兜底能力，但生产数字人构建必须显式通过守卫。

## 非目标

- 不修改后端 TRTC 密钥、鉴权、计费或 Redis 会话归属逻辑。
- 不把每台机器的 `VITE_TERMINAL_ID` 强制写入通用生产构建。
- 不重做 AI 助手页面 UI。
- 不改变 Kiosk 普通 mock/dev 文字助手模式。
- 不新增重复入口。

## 允许修改文件范围

- `apps/kiosk/vite.config.ts`
- `apps/kiosk/src/pages/assistant/AssistantPage.tsx`
- `apps/kiosk/src/vite-env.d.ts`
- `apps/kiosk/.env.example`
- `apps/kiosk/package.json`
- `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`
- `docs/device/production-deployment-runbook.md`
- `docs/progress/current-progress.md`
- `.ccg/tasks/guard-kiosk-trtc-assistant/*`

## 验证方式

- 先写失败用例：缺少数字人生产门禁时，verify 脚本必须失败。
- 负向构建：`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build` 必须失败，并提示 `VITE_USE_TRTC_CALL`。
- 正向构建：`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build` 必须通过。
- 逃生构建：`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_ALLOW_TEXT_ONLY_ASSISTANT=true pnpm --filter @ai-job-print/kiosk build` 必须通过。
- 完成后做 Claude + Antigravity 双模型审查。
