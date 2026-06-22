# 用户文件与简历资产生产/试运营验收证据包审查

## 方案审查

双模型结论：按既定顺序推进，先补证据包与静态门禁，不直接执行生产验收。

必须落实项：

- 静态 verify 必须明确 `STATIC DOC CHECK ONLY`，不得被误读为生产/试运营完成。
- 证据包必须覆盖 PostgreSQL、COS 私有桶、会员账号、上传原始文件、上传优化后或修改后文件、90 天、180 天、长期保存、重登查看、跨账号越权否定测试、删除三态一致、过期清理、`long_term` 防误删、ActivityLog、签名 URL TTL、脱敏和停止/回滚。
- COS 生命周期证据必须包含腾讯云控制台截图，禁止配置 Bucket 全局过期规则；`users/` 不得配置 Expiration；只允许 `tmp/` 临时前缀做兜底清理。
- 不得触碰运行时代码、数据库 schema、COS 后端实现、Kiosk/Admin UI。

## 最终审查

Antigravity：APPROVE。

- Critical：无。
- Warning：静态正则匹配未来可能因重构产生误报；真实 COS live 验证需严格隔离凭据和环境。
- 结论：变更为纯文档 + 静态门禁，未连接生产资源，覆盖核心验收项。

Claude：APPROVE，建议合入前补 1 行文档说明。

- Critical：无。
- Warning：文档原先把手动 `cleanup-expired` 与 `file.cleanup_expired` 审计绑定，但运行时只在 cron 路径写入该审计。
- 处理：已在 `docs/acceptance/user-file-assets-trial-acceptance.md` §4.4 明确 `ActivityLog` 只由 cron 路径写入；手动接口只核对返回值、DB 与 COS 状态。

## 验证记录

已执行：

```bash
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:file-lifecycle-summary
pnpm --filter @ai-job-print/api typecheck
git diff --check
```

结论：

- 全部通过。
- `verify:production-runtime-gates` 首次执行前因本 worktree 缺少生成的 Prisma client 失败；已按项目脚本执行 `db:pg:generate` 与默认 `prisma generate` 后复跑通过。
- 生成的 Prisma client 产物未纳入本次 Git 变更。

## 剩余风险

- 本分支只证明证据包和静态门禁完整，不证明真实生产/试运营链路已经完成。
- 真实验收仍需服务器、域名/HTTPS、PostgreSQL、Redis、COS 私有桶、会员测试账号、管理员账号、Windows 真机和法务材料。
