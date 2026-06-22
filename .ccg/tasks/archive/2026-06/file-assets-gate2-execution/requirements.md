# 用户文件与简历资产预生产 Gate 2 执行需求

## 用户确认

用户已明确回复：

```text
确认执行用户文件与简历资产预生产 Gate 2。
```

## 目标

- 仅刷新预生产 `/srv/ai-job-print` 到冻结候选 `2187f6a7`。
- 执行候选所需的加法 PostgreSQL migrations。
- 保持用户文件、COS 对象、业务数据、密钥、nginx、DNS、正式生产和 Windows 真机不变。
- 记录可审计执行证据，完成后更新验收记录。

## 非目标

- 不修改正式生产域名、证书、DNS 或 nginx。
- 不修改短信、OCR、TRTC、ASR/TTS 配置。
- 不修改 COS 生命周期规则或真实对象。
- 不执行 Windows 真机、打印、扫描或试运营 Gate。
- 不把 Gate 2 结果表述为正式生产、Windows 真机或试运营完成。

## 允许的远端变更

- `/srv/yitiji-preprod-2187f6a7.tar.gz`
- `/srv/yitiji-preprod-2187f6a7.sha256`
- `/srv/ai-job-print-candidate-2187f6a7`
- `/srv/db-backups/pre-file-assets-gate2-<timestamp>.dump`
- `/srv/ai-job-print-prev-<timestamp>`
- `/srv/ai-job-print`
- 候选目录内依赖、Prisma client 和构建产物
- 候选加法 PostgreSQL migrations
- PM2 `ai-job-print-api` restart

## 验证要求

- 本地候选包 sha256 与远端 sha256 一致。
- 迁移前 DB 备份存在且非空。
- PostgreSQL migration status 最终 up to date。
- API、Kiosk、Admin 构建通过。
- `DEPLOY_SOURCE.txt` 显示 `commit=2187f6a7`。
- API dist hash 与候选构建 hash 一致。
- PM2 `ai-job-print-api` online。
- 本机与公网 health 均返回 `success=true` 且 `db=postgres`。
- 不输出 `.env`、数据库 URL、账号密码、COS bucket 全名或密钥。

## 回滚

如切换或 health 失败：

- 将失败目录移动到 `/srv/ai-job-print-failed-<timestamp>`。
- 恢复 `/srv/ai-job-print-prev-<timestamp>` 为 `/srv/ai-job-print`。
- 重启 PM2 并复查 health。
- 加法 PostgreSQL migrations 不自动反向回滚；仅在验证为 schema/data 紧急情况时考虑使用 DB 备份。
