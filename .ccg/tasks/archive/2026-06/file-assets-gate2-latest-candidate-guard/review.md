# 用户文件资产 Gate 2 最新候选防回退（审查记录）

## 变更摘要

- 将后续 Gate 2 建议目标候选从上一代 `9a702981` 刷新为当前本地门禁链 `2187f6a7`。
- 更新 Gate 2 refresh plan、审批包、执行记录、Gate 3/Gate 4 runbook、商业闭环审计、进度入口和静态验证脚本中的操作型候选引用。
- 保留 `9146fa1c` 为原始历史预检候选，保留 `9a702981` 为上一代历史候选；阻断 `9a702981` 的操作型归档、候选目录、sidecar、`commit=` 和 checkout 命令回流。
- 重新生成本地裁剪运行时归档并完成本地构建预检；本分支未连接预生产、未上传候选包、未迁移数据库、未重启 PM2、未写 COS/账号/浏览器验收数据。

## TDD 记录

1. RED：先将 `verify:file-assets-trial-acceptance` 的 `gate2Candidate` 改为 `2187f6a7`，运行 `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`，失败信息为 `Gate 2 refresh plan must mention current Gate 2 candidate marker: 2187f6a7`。
2. GREEN：同步 Gate 2 操作型文档和历史对照后，同一命令通过。

## 本地裁剪包构建预检

- 归档：`/tmp/yitiji-preprod-2187f6a7.tar.gz`
- 归档 sha256：`6019de34f837850b22eb7ab12f9b0d25ea6fa14bac3fcfc827441803123e4b07`
- 解压目录：`/tmp/yitiji-gate2-runtime-build-check-2187f6a7/ai-job-print`
- 归档范围：不包含 `docs/`、`.ccg/`、`.env.example`
- `pnpm install --frozen-lockfile`：PASS
- SQLite Prisma client：PASS
- PostgreSQL Prisma client：PASS
- API build：PASS
- Kiosk production build：PASS，显式 `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true`
- Admin production build：PASS，显式 `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1`
- `services/api/dist/main.js` sha256：`d309c660b685680409ddf441f8ec5401d4810d61ad2162bc666bf7ab7e27b5b8`

## 验证

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`：PASS
- `git diff --check`：PASS
- 精确密钥与招聘红线扫描：PASS，无命中；初始扫描命中的 `PGPASSWORD` 仅为 `unset` 命令中的环境变量名，不是密钥值。

## 双模型分析结论

- Claude：建议刷新到 `2187f6a7`；`oldGate2Candidate` 应升为 `9a702981`，`9146fa1c` 保留为更早历史证据；本地裁剪包构建预检必须重跑。
- Antigravity：同意刷新；要求严格区分操作型候选引用和历史证据，并记录 API dist hash 与旧候选一致。

## 双模型审查结论

- Claude：APPROVE，无 Critical/Warning。确认三级谱系 `9146fa1c` -> `9a702981` -> `2187f6a7` 清晰，旧候选无操作型残留，构建证据未夸大。
- Antigravity：APPROVE，无 Critical/Warning。确认操作型文档已刷新到 `2187f6a7`，历史候选保留清楚，合规和密钥风险无命中。

## 结论

本分支完成 Gate 2 后续建议候选的本地刷新和防回退收口。当前仍未执行预生产 Gate 2、Gate 3/Gate 4、正式生产、Windows 真机或试运营验收。
