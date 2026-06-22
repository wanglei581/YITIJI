# 用户文件与简历资产预生产 Gate 4 受控验收

## 目标

- 在预生产服务器真实 PostgreSQL、Redis、COS 私有桶环境下，执行用户文件与简历资产闭环验收。
- 由于腾讯云短信仍在审核，临时将预生产 `SMS_PROVIDER` 切换为 `log`，使用受控测试账号完成会员登录验收。
- 验收后必须回滚 `SMS_PROVIDER=tencent` 并复核服务健康。

## 非目标

- 不修改生产环境。
- 不修改第三方腾讯云资源、COS 生命周期规则或 CAM 权限。
- 不触碰真实用户文件。
- 不开发招聘平台闭环能力。

## 允许修改

- 服务器 `/srv/ai-job-print/services/api/.env` 的 `SMS_PROVIDER`，且必须回滚。
- 预生产数据库中的本轮受控测试账号、测试文件、审计日志。
- 仓库文档：`docs/acceptance/user-file-assets-preprod-execution-record.md`、`docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md`、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- 本任务记录：`.ccg/tasks/file-assets-gate4-preprod-acceptance/`。

## 验证方式

- 真实 HTTP API 执行会员登录、上传、保存期限调整、预览/下载签名 URL 生成、跨账号否定、删除、过期清理、后台生命周期汇总。
- 数据库侧只读/限定写验证文件状态、保留期限和审计日志。
- COS 侧通过应用链路验证对象写入、读取、删除；输出仅保留脱敏摘要。
- 回滚短信 Provider 后复核 PM2 online 与 `/api/v1/health`。

## 回滚方式

- 从本轮 `.env` 备份恢复或仅将 `SMS_PROVIDER` 改回 `tencent`，重启 `ai-job-print-api`。
- 删除或标记本轮临时管理员账号；测试文件如保留作为证据，必须在文档中标明测试来源。
- 若验收脚本中途失败，先回滚短信配置，再评估是否需要清理本轮测试数据。
