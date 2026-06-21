# 双模型审查记录

## 审查对象

- 分支：`codex/preprod-deployment-acceptance`
- 基线：`origin/main@c31e0b1`
- 合入：`codex/guard-kiosk-trtc-assistant@6b055d6b`
- 本轮新增任务记录：`.ccg/tasks/preprod-deployment-acceptance/`

## 验证输入

- `pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard`：ALL PASS。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build`：PASS，仅既有大 chunk warning。
- `pnpm --filter @ai-job-print/kiosk lint`：0 errors，2 个既有 Fast Refresh warnings。
- `pnpm --filter @ai-job-print/api verify:production-runtime-gates`：ALL PASS。

## Claude 审查结论

- Critical：无。
- Warning：
  - CI build env 给 API 与 Kiosk 共用 `VITE_USE_TRTC_CALL=true`，实际无害；提醒 CI 后续恒定覆盖数字人构建路径，纯文字逃生口不在 CI 中构建覆盖。
  - 预生产/生产环境必须确认 `VITE_ALLOW_TEXT_ONLY_ASSISTANT` 未误设，除非明确纯文字部署。
- Info：
  - Vite 点号访问与 DCE 改动正确。
  - 构建期门禁和 dev warn 条件正确。
  - 无招聘平台闭环、无生产门禁回退、无密钥或真实用户数据风险。
  - `plan.md` 已明确 HTTP IP 不等于生产验收，域名 HTTPS 和短信 E2E 为待补验。
- Verdict：APPROVE。

## Antigravity 审查结论

- Critical：无。
- Warning：无。
- Info：
  - 预生产 TRTC/麦克风测试必须使用 HTTPS 安全上下文，临时 HTTPS/hosts 映射是强制运维指引。
  - `VITE_ALLOW_TEXT_ONLY_ASSISTANT` 是显式逃生口，后续生产同步前必须审计环境变量，避免数字人入口静默失效。
- Verdict：APPROVE。

## 执行带入项

- 预生产/生产环境检查必须包含：`VITE_ALLOW_TEXT_ONLY_ASSISTANT` 未设置。
- HTTP IP 只作为基础链路；真实简历上传、麦克风、TRTC 必须走临时 HTTPS/hosts 或正式域名 HTTPS。
- 继续保持合规停止条件：发现平台内投递、企业筛简历、面试邀约、Offer 管理等招聘闭环即停止。
