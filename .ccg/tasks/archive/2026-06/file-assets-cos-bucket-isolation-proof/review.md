# 用户文件资产 COS bucket 隔离阻塞确认审查

## 只读取证

- 预生产服务器只读输出：`COS_BUCKET_PROOF fp=7637995480 strict_nonprod=false prod_label=true project_label=true`。
- 未回显完整 bucket 名、CAM 密钥、连接串、token 或签名 URL。
- 本轮未运行 `verify:cos:live`，未写 COS，未改 `.env`，未改腾讯云配置。

## 结论

- 当前预生产 env 指向的 COS bucket 应按生产语义桶处理。
- G3-06 `verify:cos:live` 和 Gate 4 文件资产验收继续暂停。
- 后续必须先切换到明确隔离的预生产 COS bucket，或提供等效隔离证明，才能设置 `COS_BUCKET_PREPROD_PROOF_CONFIRMED=true` 并继续 G3-06/Gate 4。

## 验证

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`：PASS。
- `pnpm --filter @ai-job-print/api typecheck`：PASS。
- `git diff --check`：PASS。
- 严格敏感信息扫描：PASS。

## 双模型审查

- Claude 首轮：APPROVE，无 Critical；提出两个防回退 Warning：
  1. runbook 新增禁止设置 `COS_BUCKET_PREPROD_PROOF_CONFIRMED=true` 的规则需要被静态门禁断言保护。
  2. 需要断言 G3-06 `verify:cos:live` 维持 `BLOCKED`，并防止误写 Gate 3 完整通过。
- Antigravity 首轮：APPROVE，无 Critical、无 Warning。
- 已修复 Claude Warning：
  - `verify:file-assets-trial-acceptance` 断言 runbook 保留 `COS_BUCKET_PREPROD_PROOF_CONFIRMED=true` 禁止规则、`prod_label=true` 和历史生产私有桶指纹一致口径。
  - `verify:file-assets-trial-acceptance` 断言执行记录中 G3-06 行保持 `BLOCKED`、保留 `未执行：G3-06 COS live`，并阻止 full Gate 3 pass banner。
- 复审：
  - Claude：APPROVE，无 Critical、无 Warning。
  - Antigravity：APPROVE，无 Critical、无 Warning；Info 级文案已修正。

## 后续

下一任务应是用户在腾讯云创建或确认独立预生产 bucket，并把预生产服务器 `.env` 切换到该 bucket 后，再执行 G3-06 `verify:cos:live` 与 Gate 4 账号/文件验收。该操作会修改第三方资源和服务器运行时配置，必须单独确认目标、非目标、允许修改范围、验证方式和回滚方式。
