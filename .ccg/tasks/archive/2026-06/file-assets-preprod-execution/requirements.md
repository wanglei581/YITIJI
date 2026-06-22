# 用户文件与简历资产预生产真实验收执行计划

## 任务背景

当前 `codex/file-assets-preprod-integration` 已集成用户文件保存期限、Kiosk 文件管理、Admin 生命周期视图、COS 生命周期合规口径、试运营证据包和预生产阶段性记录。该候选仅证明代码与文档候选已集成并通过本地静态/类型验证，不证明真实生产或试运营已完成。

本任务从 `9146fa1c` 创建独立分支 `codex/file-assets-preprod-execution`，只推进预生产真实验收的执行准备、证据路径和门禁计划；任何会修改服务器、数据库、COS、测试账号或第三方资源的操作必须在计划审查和用户确认后再执行。

## 本轮目标

- 定义基于 `9146fa1c` 的预生产验收执行顺序。
- 固化目标、非目标、允许修改文件、验证方式、停止条件和回滚方式。
- 建立预生产执行记录模板，后续真实执行时可逐项填写证据。
- 通过 Claude + Antigravity 双模型审查，确认不会把静态验证、预生产阶段性结果或本地 verify 误写成生产/试运营完成。

## 非目标

- 不新增业务功能、API、数据库 schema、Kiosk 页面、Admin 页面或 COS 生命周期规则。
- 不直接部署代码到服务器。
- 不运行 `migrate deploy`、seed、数据库写入、COS live 写入、上传真实用户文件或创建测试账号。
- 不修改第三方云资源、密钥、域名、证书、短信、OCR、TRTC、ASR/TTS 配置。
- 不宣称正式生产上线、真实试运营或 Windows 真机验收完成。

## 允许修改文件

- `.ccg/tasks/file-assets-preprod-execution/*`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

除上述文件外，默认禁止修改。若后续真实验收发现必须修代码，另开独立修复分支。

## 验收前置

- 基线分支为 `codex/file-assets-preprod-integration`，提交 `9146fa1c`。
- 预生产服务器当前只记录为阶段性通过，不等于正式域名、正式 HTTPS、短信、OCR、AI/TRTC/ASR/TTS、Windows 真机或小范围试运营完成。
- 冷环境执行生产运行时门禁前，先执行：

```bash
pnpm install --frozen-lockfile
pnpm --filter @ai-job-print/api exec prisma generate
pnpm --filter @ai-job-print/api db:pg:generate
```

## 风险与停止条件

出现以下任一情况必须停止扩大执行范围：

- 计划审查出现 Critical 问题。
- 当前分支不在 `codex/file-assets-preprod-execution` 或工作区存在不明未提交改动。
- 预生产服务器实际 commit 不是计划指定候选，且无法确认差异。
- `.env`、命令日志、截图或报告存在密钥、token、完整手机号、签名 URL 查询串或简历正文。
- PostgreSQL 与 COS 删除状态不一致。
- `long_term` 文件在清理后消失，或长期保存未保持 `expiresAt = null`。
- 会员 B 可读、下载或删除会员 A 文件。
- COS 生命周期存在 Bucket 全局过期规则，或 `users/` / 会员简历 / AI 成果物前缀被 Expiration 覆盖。

## 回滚方式

- 若只完成计划与预检：回滚本分支文档提交即可，不影响预生产环境。
- 若后续已部署候选：恢复上一版构建产物和 PM2 进程配置；不删除历史用户文件。
- 若后续已修改数据库：先保留 `pg_dump`，再按数据库恢复方案回滚；禁止直接手工删除不明业务数据。
- 若后续已写 COS：只删除受控测试对象；不得批量清理业务前缀。
- 若出现泄露：立即停止证据传播，轮换相关密钥/token，删除或重打码泄露材料。

## 必须留存证据

- 本地计划审查记录：Claude + Antigravity 输出。
- 预生产服务器只读预检日志。
- 命令执行日志路径、执行时间、commit、执行人。
- 浏览器截图、COS 控制台截图、PostgreSQL 抽样查询、ActivityLog 抽样查询。
- 所有证据必须脱敏：手机号、token、签名 URL、COS key、文件名、简历正文。
