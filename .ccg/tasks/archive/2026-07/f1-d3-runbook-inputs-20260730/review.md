# F1 D3 runbook 与 managed 输入清单终审

## 结论

- Claude：`APPROVE`，Critical 0，Warning 0。
- antigravity：`APPROVE`，Critical 0，Warning 0。
- Cursor Agent：`APPROVE`，Critical 0；两项非阻塞 housekeeping 已处置如下。
- Codex：代码契约、文件范围、fail-closed 状态、秘密边界和进度口径复核通过。

## Cursor 非阻塞意见处置

1. 历史 D3 预检报告仍记录“当时 runbook 为旧 16 参数面”：保留。该报告是 2026-07-30
   预检时点证据，改写会损害历史可追溯性；现行 runbook、current-progress 和 next-tasks 已明确后续
   修正。该报告也不在本任务批准的文件预算内。
2. 实施计划尚未勾选：已同步所有完成项；归档项在本任务归档时关闭。

## 验证证据

- `pnpm --filter @ai-job-print/api verify:release-provenance`：24 项全部通过，包含拒绝 legacy
  16 参数 activation 合同。
- `pnpm --filter @ai-job-print/api verify:release-genesis`：9 个场景全部通过。
- `pnpm --filter @ai-job-print/api typecheck`：通过。
- `pnpm --filter @ai-job-print/api lint`：通过。
- 自动文档核对：activation 10 个 flag 与源码集合及顺序一致；B1–B9、四态词法、正式引用目标齐全。
- `git diff --check`：通过。
- 敏感信息检查：变更的 runbook §6.2 与新输入模板无秘密赋值、真实凭据、legacy PM2 字面命令或
  主机专属 PM2 dump 路径。

## 风险边界

本任务只修改文档和 CCG 任务记录；没有连接生产环境，没有 SSH，没有读取秘密，没有执行
Genesis、activate、部署、PM2、Nginx、迁移或切流。B1–B9 仍未获得生产输入并完成只读核验，
production F1 继续 `NO-GO`。
