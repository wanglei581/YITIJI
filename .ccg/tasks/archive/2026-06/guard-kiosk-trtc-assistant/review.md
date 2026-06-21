# 审查与验证记录

## 双模型审查

- Antigravity：无 Critical；Warning 为 `verify:assistant-trtc-guard` 未接入 CI，Info 为建议 `import.meta.env` 改点号访问。
- Claude：无 Critical；Major 同样为 `verify:assistant-trtc-guard` 未接入 CI；Minor 为纯文字逃生口日志文案可能误导。

## 已处理反馈

- `.github/workflows/ci.yml` 的 Verify suites 已新增 `pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard`。
- `AssistantPage.tsx` 已改为 `import.meta.env.VITE_USE_TRTC_CALL` 点号访问。
- `VITE_ALLOW_TEXT_ONLY_ASSISTANT` 日志已改为“跳过数字人强制校验，数字人是否启用以 VITE_USE_TRTC_CALL 为准”。

## 复审结论

- Antigravity 复审：无 Critical / Warning，结论 APPROVE。
- Claude 复审：无 Critical / Warning，确认 CI 接入、点号访问和逃生口文案均已修复，结论 APPROVE。

## 验证结果

- `pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard`：PASS。
- `pnpm --filter @ai-job-print/kiosk typecheck`：PASS。
- `pnpm --filter @ai-job-print/kiosk lint`：PASS，保留既有 `KioskBusyContext` Fast Refresh 2 warning，0 error。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`：按预期 FAIL，提示必须设置 `VITE_USE_TRTC_CALL=true` 或显式纯文字逃生口。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build`：PASS，产物包含 `AiAdvisorCall` 与 `trtc` chunk。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_ALLOW_TEXT_ONLY_ASSISTANT=true pnpm --filter @ai-job-print/kiosk build`：PASS，显式纯文字逃生口生效。
- `pnpm --filter @ai-job-print/kiosk dev -- --host 127.0.0.1`：可启动，并在终端提示数字人未启用和 `dev:trtc` 命令。
- `pnpm --filter @ai-job-print/kiosk dev:trtc -- --host 127.0.0.1`：可启动，不再提示数字人未启用。
