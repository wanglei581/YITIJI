# 用户文件资产预生产 COS bucket 切换审批包审查

## 盘点结果

- 本地无 `tencentcloud` / `coscmd` / `tccli`。
- 预生产服务器无 `tencentcloud` / `coscmd` / `tccli`。
- 现有 `verify:cos:live` 只支持对象级 put/head/get/signed-url/delete，不能创建或配置 bucket。
- 当前未修改腾讯云、未修改服务器 `.env`、未重启 PM2、未执行 COS live。

## 本轮交付

- 新增 `docs/acceptance/user-file-assets-preprod-cos-switch-approval.md`。
- 明确预生产 COS bucket 切换的目标、非目标、需要用户提供的信息、允许修改范围、禁止事项、执行步骤、验证方式和回滚方式。
- 更新 `current-progress.md` 与 `next-tasks.md`，明确下一步先由用户在腾讯云创建或确认明确隔离的预生产 bucket。
- 更新 `verify:file-assets-trial-acceptance`，防止审批包被误写成已切换或已完成。

## 验证

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`：PASS。
- `pnpm --filter @ai-job-print/api typecheck`：PASS。
- `git diff --check`：PASS。
- 严格敏感信息扫描：PASS。

## 双模型审查

- Claude 首轮：APPROVE，无 Critical；提出 1 个 Warning：审批包完成宣称正则覆盖不够宽。
- Antigravity 首轮：APPROVE。
- 已修复：加宽 `completionClaim` 正则，并在 `negativeContext` 中允许合法的 `安全子集` / `暂停` / `PARTIAL` 限定上下文，避免误报。
- Claude 复审：APPROVE，无 Critical、无 Warning。
- Antigravity 复审：APPROVE，无 Critical、无 Warning；Info 建议后续可覆盖英文 completion 关键词。

## 结论

本轮仅完成审批包和执行边界。真正的下一步仍需要用户提供或确认：

- 明确隔离的预生产 bucket 名。
- region。
- 私有读写设置。
- CAM 最小权限范围。
- 生命周期规则截图/确认。
- 如浏览器直传需要，CORS 边界。

缺少这些信息时，不得修改预生产服务器 `.env`，不得设置 `COS_BUCKET_PREPROD_PROOF_CONFIRMED=true`，不得执行 G3-06 或 Gate 4。
