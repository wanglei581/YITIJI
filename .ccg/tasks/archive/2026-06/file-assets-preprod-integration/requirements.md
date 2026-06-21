# 用户文件资产商用闭环与预生产验收候选集成需求

## 背景

- `codex/file-assets-trial-acceptance@82914b97` 已完成用户文件保存期限、Kiosk 自助设置、Admin 生命周期视图、COS/隐私合规、生产/试运营验收证据包。
- `codex/preprod-deployment-acceptance@0cfa5b72` 已完成 Kiosk `/assistant` TRTC 生产构建守卫合入，并记录百度云预生产阶段性验收事实。
- 两个分支共同基线均为 `origin/main@c31e0b10`，但当前预生产候选分支尚不包含文件资产保存期限栈；文件资产分支也尚不包含 TRTC guard 和预生产阶段性记录。

## 目标

1. 创建统一部署候选分支 `codex/file-assets-preprod-integration`。
2. 将 `codex/preprod-deployment-acceptance` 合入文件资产闭环栈，形成包含文件资产商用闭环和 TRTC guard 的预生产候选。
3. 解决 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 等进度文档冲突，保留两个分支的真实结论，不把预生产阶段性验收冒充为生产完成。
4. 运行文件资产、COS、生产运行时、Kiosk TRTC guard、Kiosk/Admin/API 类型与最小相关验证。
5. 完成 Claude + Antigravity 双模型最终审查后归档任务并提交。

## 非目标

- 不连接生产服务器、数据库、Redis、COS 或 Windows 真机。
- 不执行部署、推送、合并远端或修改第三方资源。
- 不新增业务功能。
- 不修改文件保存期限策略、数据库 schema 或 TRTC 业务逻辑，除非合并冲突必须做纯整合修正。
- 不声称正式域名/HTTPS、腾讯短信、百度 OCR、AI/TRTC/ASR/TTS live、Windows 真机或小范围试运营已完成。

## 允许修改范围

- 允许通过 merge 引入 `codex/preprod-deployment-acceptance` 已有提交内容。
- 允许解决合并冲突涉及的进度文档、部署 runbook、CI/Kiosk guard 相关文件。
- 允许新增/归档 `.ccg/tasks/file-assets-preprod-integration/`。
- 允许新增 `docs/superpowers/plans/2026-06-22-file-assets-preprod-integration.md`。
- 禁止手工扩大到无关重构、UI 改版、生产配置或密钥文件。

## 验证方式

至少运行：

```bash
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:file-lifecycle-summary
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
pnpm --filter @ai-job-print/kiosk verify:file-retention-ui
pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
pnpm --filter @ai-job-print/admin verify:admin-file-lifecycle-ui
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
git diff --check
```

## 回滚方式

- 未合入前直接删除本 worktree/分支。
- 如合并后验证失败且无法局部修复，回退 merge commit，保留两个原始分支不变。
- 如只是文档冲突或验证脚本口径问题，仅修正文档/脚本，不改运行时代码。
