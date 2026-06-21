# COS 生命周期与隐私文案验收审查记录

## 范围

- 更新 Kiosk 采集点、帮助中心和隐私政策的文件保存期限说明。
- 更新 Admin 文件管理合规横幅。
- 新增 COS 生命周期与文件保存期限合规验收文档。
- 更新生产部署 runbook/checklist，加入 COS 防误删人工验收。
- 新增静态防回退验证，不连接或修改真实 COS 资源。

## 双模型方案审查

- Claude：REQUEST_CHANGES。指出必须补 `KIOSK_RESUME_UPLOAD_PRIVACY` 采集点文案，不能只改隐私页；必须记录隐私文案与 `CURRENT_RETENTION_CONSENT_VERSION` 的耦合，不得静默 bump；verify 需扫描 COS backend 禁止桶级 lifecycle 写操作。以上均已采纳。
- Antigravity：APPROVE，建议新增 COS 生命周期合规文档、部署清单、法律文案和 verify。其读取的是历史 worktree，因此只采纳与当前 worktree 一致的架构建议。

## 已修复风险

- 旧“分析完成后 1 小时内自动删除”采集点文案已移除。
- 旧“通常 1 小时内”和“默认 24 小时”通用短留存口径已由防回退脚本禁止。
- `long_term` / `expiresAt = null` 不被 COS Bucket 全局生命周期误删的人工验收要求已写入文档和部署清单。
- 保存条款版本耦合已写入合规文档，本分支不静默修改 `FILE_RETENTION_CONSENT_VERSION`。

## 验证

- `pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy`
- `pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy`
- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `pnpm --filter @ai-job-print/api typecheck`

## 最终双模型复审

- Antigravity：PASS，无 Critical / Warning。
- Claude：PASS，无阻断项；提示 `docs/product/*` 与历史计划中仍有旧 TTL 参考口径。该项已登记到 `docs/progress/next-tasks.md`，后续另起独立分支统一，不在本分支继续扩大范围。

## 剩余事项

- 真实 COS 控制台生命周期状态仍需在生产/试运营验收时人工确认并截图存档。
- 下一步进入 PostgreSQL + COS + 会员账号的生产/试运营全链路验收。
