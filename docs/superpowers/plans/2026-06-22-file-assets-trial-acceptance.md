# 用户文件与简历资产生产试运营验收证据包计划

## 目标

在不连接生产资源、不修改运行时代码的前提下，为用户文件与简历资产商用闭环建立可执行证据包，确保后续真实生产/试运营验收不会漏掉 PostgreSQL、COS 私有桶、会员账号、保存期限、删除、过期清理、`long_term` 防误删、审计和脱敏。

## 非目标

- 不执行生产部署。
- 不连接真实生产 PostgreSQL、Redis、COS 或短信/OCR/AI 服务。
- 不新增业务功能、接口、schema 或 UI。
- 不修改既有文件保存期限策略、删除逻辑或 COS 后端实现。
- 不声称生产/试运营已完成。

## 允许修改文件

- `.ccg/tasks/file-assets-trial-acceptance/task.json`
- `.ccg/tasks/file-assets-trial-acceptance/review.md`
- `docs/superpowers/plans/2026-06-22-file-assets-trial-acceptance.md`
- `docs/acceptance/user-file-assets-trial-acceptance.md`
- `docs/device/production-deployment-and-windows-host-checklist.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `services/api/package.json`

## 执行顺序

1. 双模型方案审查，确认可以先做证据包而不是直接上生产。
2. TDD：先新增 `verify:file-assets-trial-acceptance`，确认缺少证据包时失败。
3. 新增 `docs/acceptance/user-file-assets-trial-acceptance.md`，所有真实生产项默认保持 `[ ] PENDING REAL-EVIDENCE`。
4. 在生产部署清单 4.3 和 6.2 交叉引用证据包，避免重复改写既有 COS/服务器门禁。
5. 更新进度与下一步任务，明确本分支是证据包就绪，真实生产/试运营执行仍待完成。
6. 跑最小相关验证和双模型最终审查。

## 验证方式

```bash
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:file-lifecycle-summary
pnpm --filter @ai-job-print/api typecheck
git diff --check
```

## 回滚方式

本分支未合入前可直接丢弃；合入后如证据包口径需要调整，只回滚文档和静态 verify 脚本，不影响运行时代码、数据库和 COS 对象。
