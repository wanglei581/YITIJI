# 任务范围

## 目标

1. 合并已通过全部 CI 的纯文档 PR #394。
2. 以合并后的最新 `main` 为唯一候选，评估预生产完整 API 发布是否能安全吸收 `admin-phone-transfer` 增量覆盖。
3. 仅在差异、配置、数据库和回滚门禁全部满足后执行发布，并完成只读验收。

## 允许修改

- GitHub PR #394 的合并状态。
- 预生产 `/srv/ai-job-print` 的 API 运行时源码与构建产物，仅按经审查的完整 API 发布方案执行。
- 预生产 `DEPLOY_SOURCE.txt` 部署来源记录。
- 服务器私有回滚备份目录。
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- 本任务 `.ccg/tasks/` 记录。

## 禁止修改

- 不修改真实账号、手机号、密码、验证码、短信状态或任何业务数据。
- 不调用真实认证、短信或手机号转移写接口。
- 不改 `.env`、Redis、COS、支付配置、前端 dist、Terminal Agent 或 Windows 主机。
- 未确认 migration 差异和数据库备份策略前，不执行数据库 migration/seed。
- 不新增入口、页面、数据模型、依赖或无关重构。

## 验收

- PR #394 合并后 `main` 状态和 CI 结论可验证。
- 候选提交、服务器基线、API 差异和依赖/schema/migration 差异有明确证据。
- 发布前有可用回滚点；失败自动或人工可回滚。
- 部署后 PM2 online，内外 health 为 `ok/postgres`，三端入口可达且前端 bundle 未变化。
- 认证门禁运行字节与候选一致；无敏感值写入日志或仓库。
- 双模型终审无 Critical/High 后才保留部署。
