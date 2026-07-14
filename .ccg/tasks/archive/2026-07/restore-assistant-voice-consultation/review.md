# 恢复 AI 助手语音咨询审查记录

## 本地验证

- `pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard`：PASS。
- `pnpm --filter @ai-job-print/kiosk verify:lightflow-4188-layout-parity`：PASS。
- `pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career`：PASS。
- `pnpm --filter @ai-job-print/kiosk typecheck`：PASS。
- `pnpm --filter @ai-job-print/kiosk lint`：0 error；2 条既有 `KioskBusyContext.tsx` Fast Refresh warning。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=local-lightflow-voice pnpm --filter @ai-job-print/kiosk build`：PASS。

## 浏览器验证

- `http://127.0.0.1:5174/assistant` 可打开。
- 点击“语音咨询”只打开 4188 风格选择弹层，请求列表未出现业务请求，未自动启动 TRTC。
- 1080x1920、390x844、390x700 均已截图复查；移动端选择层无横向溢出。
- 关闭弹层后 `body` 滚动恢复，焦点回到“语音咨询”按钮。

## 双模型审查

- Antigravity 首轮：`REQUEST_CHANGES`，指出音量静默状态与通话态焦点问题；已修复。
- Claude 首轮：`REQUEST_CHANGES`，指出 connecting 阶段挂断/切换方式后 in-flight `startCall` 可能复活并继续计费；已用 session epoch 修复。
- Antigravity 复审：`APPROVE`。
- Claude 复审：`APPROVE`；建议补强 guard，已补充 `taskIdRef.current === activeTaskId`、音量分支精确断言和挂断焦点断言。

## 剩余边界

- 未点击“直接语音通话”做真实 TRTC 入房，因为当前本地验收没有正式后端凭证、麦克风授权和计费环境。
- 本项不能宣称线上、真机、真实 TRTC 或物理设备验收完成。
