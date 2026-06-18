## 审查结论

- Antigravity 初审：Request Changes；指出去掉 100 条限制后原逐条 `upsert` 会形成无上限 N+1，并存在部分更新风险。
- Claude 初审：Approve with warning；同样建议改成批量写入。
- 已处理：`markAllRead` 改为事务内 `updateMany` + `findMany` + `createMany`，避免 N+1，并用真实写入数返回 `updated`。
- Antigravity 复审：Approve；确认 N+1 和一致性问题已解决，提示极大广播量仍需关注批量大小。
- Claude 复审：Approve；提示同一用户并发点击可能遇到唯一约束竞态，事务会回滚不产生半更新，作为非阻塞后续优化记录。

## 验证

- `pnpm --filter @ai-job-print/api verify:feedback-notifications`：ALL PASS，新增 7c 覆盖超过 100 条广播全部已读。
- `pnpm --filter @ai-job-print/api build`：通过。
- `git diff --check`：通过。

## 结论

这是商用闭环中发现的真实行为修复：公网库存在 100 条以上广播时，原“全部已读”不会清空所有未读。修复后该接口能处理超过 100 条广播，并由服务级脚本固定回归。
