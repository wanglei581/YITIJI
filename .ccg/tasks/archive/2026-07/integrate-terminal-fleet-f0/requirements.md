# 终端机队 F0 集成需求

## 目标

从最新 `origin/main` 建立独立集成分支，选择性迁入终端机队设计、F0 只读总览和原 F0 CCG 归档，保留主线最新管理员手机号绑定与安全事实，形成可提交 PR 的本地候选。

## 允许范围

- 迁入 `f04522c8`、`9b8434ad`、`872f71f4` 的既有内容。
- 仅手工解决 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 的文本冲突。
- 为集成结果更新当前 CCG 记录。

## 禁止范围

- 不新增 F0 之外功能，不实施 F1/F2/F3。
- 不修改 Prisma schema/migration、Terminal Agent、Kiosk、打印、支付、凭据或生产配置。
- 不部署、不操作 Windows、不连接生产数据库、不触发打印或真实换机。
- 未经本轮明确授权不 push、不创建 PR、不合并。

## 验收

- 新分支基于最新 `origin/main`，主线为其祖先。
- 三个目标提交的预期内容全部存在，两份 SSOT 同时保留最新主线事实与 F0 事实。
- API/Admin 专项 verify、typecheck、lint、build、`db:pg:sync:check`、diff/scope 检查通过。
- Claude 与 Antigravity 对集成结果均给出有效审查正文；空输出不算通过。
