# Task 1 审查与验证

## 验证

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @ai-job-print/api verify:release-provenance`（修改前） | 19 个 `PASS`，`=== ALL PASS ===` |
| `pnpm --filter @ai-job-print/api verify:release-provenance`（修改后） | 19 个 `PASS`，`=== ALL PASS ===` |
| `pnpm --filter @ai-job-print/api typecheck` | 通过 |
| `pnpm --filter @ai-job-print/api lint` | 通过 |
| `git diff --check` | 通过 |

验证只创建临时 fixture，未运行 release CLI、真实 PM2、网络、数据库、Redis 或健康端点。

## CCG 双模型复审

| 审查方 | 范围 | 结论 |
| --- | --- | --- |
| Claude Opus 4.8 | 当前两个 scripts 文件与 Task 1 要求 | `READY`；Critical 0，Important 0，Minor 2（均为未由本次引入的非阻塞观察） |
| Antigravity Gemini 3.1 Pro (High) | 当前两个 scripts 文件与 Task 1 要求 | `READY (APPROVE)`；Critical 0，Important 0，Minor 0 |

两方确认：常量已在 fixture 模块成为单一导出来源；verifier 回向导入 helpers 并保留本地 activation fixture 所需的 `mkdtempSync`；`replaceManifestCopies` 的默认第三参数保持旧调用行为，且支持后续 r1/r2 fixture。没有运行时代码、CLI、PM2、外部服务、生产/历史 F1 或业务数据改动。
