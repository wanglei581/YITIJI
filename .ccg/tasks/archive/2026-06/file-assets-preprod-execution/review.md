# 用户文件与简历资产预生产执行计划审查

## Antigravity

结论：APPROVE，需整合 Warning 建议。

Critical：

- 无。

Warning：

- Gate 2 / Gate 3 前需要显式确认预生产 `DATABASE_URL`、`REDIS_URL` 与 COS bucket/region 指向隔离资源，避免误污染正式生产资源。
- Gate 4 过期清理测试前必须查询限定只命中指定测试账号和测试文件 ID，避免影响真实用户文件。

Info：

- `verify:cos:live` 若因配置缺失而 SKIPPED，需要记录缺少的配置项名称，不记录值。
- 执行记录应写明当前保存条款版本 `FILE_RETENTION_CONSENT_VERSION=file-retention-v1`。

处理：

- 已在计划 Gate 2 / Gate 3 / Gate 4 和执行记录中补充资源隔离、测试账号限定、COS 配置缺失记录和保存条款版本。

## Claude

结论：APPROVE with minor revisions，无 Critical。

Critical：

- 无。

Warning：

- 过期清理的 `file.cleanup_expired` ActivityLog 只由 cron 路径写入；手动接口只能核对返回值、DB 与 COS 状态。
- Gate 4 执行记录缺少签名 URL TTL 验证项。
- Gate 2 使用 `git reset --hard 9146fa1c` 会让服务器上的分支 ref 语义混乱，建议 detached checkout 或直接部署集成分支。

Info：

- Kiosk production build 需要明确 `VITE_USE_TRTC_CALL=true`，否则会触发 TRTC guard 或需要审定的纯文字例外。
- Gate 1 是首个触达外部主机的步骤，应保持在计划审查和用户确认之后。
- requirements 与 execution record 的停止条件存在轻微重复，后续可继续收敛。

处理：

- 已将 Gate 2 改为 `git checkout --detach 9146fa1c`。
- 已将 Kiosk 构建命令改为 `VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build`。
- 已补签名 URL TTL 验证项。
- 已补 cron 清理审计路径说明：审计取证须走整点 cron；手动接口仅核对返回值、DB、COS。

## Integrated Decision

- Critical：无。
- Warning：均已在允许文件范围内修订。
- Info：已吸收与预生产执行相关的事项。
- Resolution：计划可进入 Gate 0 本地静态门禁；Gate 1 预生产只读预检仍需用户确认后执行；Gate 2 及以后任何外部状态变更必须再次确认目标、非目标、验证和回滚。

## Final Review

Antigravity final：APPROVE，100/100；无 Critical、Warning、Info，确认资源隔离、清理目标限定、cron 审计路径、签名 URL TTL、detached checkout、TRTC 构建变量、COS SKIPPED 配置项名称和保存条款版本均已补齐。

Claude final：APPROVE；无 Critical、无阻塞 Warning，确认 8 项前序问题均已解决，未发现生产/试运营/Windows 真机验收完成的过度声明。仅提示任务阶段示例和 `reset` 遗留措辞为 cosmetic；已修订。
