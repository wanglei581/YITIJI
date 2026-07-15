# PR #245 CI 失败复审

## 失败事实

- GitHub CI run `29405259740`：`postgres-readiness` 成功；`build-and-verify` 仅在 `verify:print-scan-first-release` 失败。
- 失败项为 `docs/progress/next-tasks.md:95` 的 F2 未完成待办：`Windows 真机换机验收必须在独立任务完成` 被过度宣称启发式误判。
- F0 的 API/Admin 专项验证、lint、typecheck、build、PostgreSQL readiness 等均未失败。

## Claude 复审

- Session：`53b94560-b785-4d7c-b8a4-e48a21e983de`。
- Verdict：`REQUEST_CHANGES`，仅因一行文档措辞阻塞 CI；Critical 0。
- 归因：`Windows 真机` 后 40 字内出现“完成”，而延期祈使词“必须”不在 verifier 豁免词表；这是未来式待办被误报，非 F0 代码或安全缺陷。
- 建议：仅将该句改为“Windows 真机换机验收仍需在独立任务完成”；不改 verifier，后者属于共享 print-scan 首发安全门禁，扩大范围且可能削弱拦截。

## Antigravity 复审

- Verdict：文档静态匹配误报，Critical 0、Warning 1（PR CI 被该文档行阻塞）。
- 建议：同意只将“必须”改为“仍需”，保留严格 verifier；随后运行 `verify:print-scan-first-release`、API typecheck/lint 与 `git diff --check`。

## 结论

- 最小修复仅涉及 `docs/progress/next-tasks.md` 一行 F2 待办措辞，不实施 F1/F2，也不改 Prisma、Agent、Kiosk、打印或生产配置。

## 修复与 CI 结果

- RED：本地 `verify:print-scan-first-release` 在原文上稳定复现 1 个误报。
- GREEN：将“Windows 真机换机验收必须在独立任务完成”改为“Windows 真机换机验收仍需在独立任务完成”。
- 本地通过：`verify:print-scan-first-release`、`verify:device-fleet-overview`、`verify:admin-device-fleet-overview-ui`、API typecheck/lint、`git diff --check`。
- 修复提交：`1952a7c6 docs: clarify pending terminal replacement acceptance`。
- PR #245 GitHub CI run `29406399120`：`build-and-verify` 成功（6m13s），`postgres-readiness` 成功（2m53s）；PR 状态为 open、non-draft、`CLEAN`。
