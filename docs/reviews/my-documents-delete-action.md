# 我的文档删除交互

> 日期：2026-06-21
> 分支：`codex/my-documents-delete-action`
> 范围：Kiosk `/me/documents`

## 目标

给「我的文档」补本人删除按钮和两步确认，继续复用已有 `deleteMyDocument`。删除由后端 `/files/:id` 归属校验、对象删除、软删和审计负责。

## 边界

- 不新增后端接口。
- 不在列表页展示或缓存文件内容。
- 不改变短期签名预览链路。
- 不把过期、已删、他人文档的存在性暴露给前端用户。

## 结论

- `/me/documents` 已支持首点确认、二次点击执行删除，确认态 3.5 秒后自动撤销。
- 查看和删除使用全局 pending 锁，避免一个文档打开/删除过程中再触发其他文档操作。
- 删除成功后本地列表即时移除，失败时给脱敏提示。
- 未登录时清空本地文档列表，避免登出或切换账号后残留旧文档元数据。

## 验证

- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`
- `pnpm --filter @ai-job-print/api verify:member-assets-c2d`

以上命令均通过；lint 仍有既有 `KioskBusyContext.tsx` fast-refresh warning，build 仍有既有 large chunk warning。

## 审查

Claude 与 Antigravity 最终均为 APPROVE。Antigravity 的并发竞态意见已通过全局 pending 锁修复。
