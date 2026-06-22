# 用户文件资产 Gate 2 部署候选冻结口径防循环（任务需求）

## 背景

上一分支已将后续 Gate 2 建议部署候选刷新为 `2187f6a7`，并在本地完成裁剪运行时归档构建预检。随后产生的 `39914fca` 是候选刷新文档和静态门禁本身的治理提交。如果每次治理文档提交都继续刷新部署候选，会形成无限循环，阻塞进入用户确认和 Gate 2 预生产执行。

当前需要明确：`2187f6a7` 是已经本地构建预检通过的 Gate 2 部署候选冻结点；`39914fca` 及后续纯治理/文档/本地门禁提交不自动改变部署候选。只有运行时代码、数据库 schema、构建输入、归档范围、生产构建变量或 Gate 2 执行命令发生实质变化时，才需要刷新部署候选并重跑本地裁剪包构建预检。

## 目标

- 在 Gate 2 refresh plan、审批包、构建预检、进度入口中明确部署候选冻结口径。
- 在 `verify:file-assets-trial-acceptance` 中增加防回退断言，确保文档不会把治理提交误当成新的部署候选。
- 保持部署候选为 `2187f6a7`，不刷新为 `39914fca`。

## 非目标

- 不执行预生产或生产远端操作。
- 不上传候选包、不迁移数据库、不重启 PM2、不写 COS/账号/浏览器验收数据。
- 不重新生成部署候选包。
- 不修改运行时代码、API 契约、数据库 schema、前端页面或 UI。
- 不宣布 Gate 2、Gate 3/Gate 4、生产、试运营或 Windows 真机验收完成。

## 允许修改文件

- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md`
- `docs/acceptance/user-file-assets-gate2-approval-package.md`
- `docs/acceptance/user-file-assets-gate2-runtime-build-check.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate2-candidate-freeze-policy/*`

## 验证方式

- TDD RED：先给 `verify:file-assets-trial-acceptance` 增加候选冻结断言，预期当前文档缺少冻结说明而失败。
- GREEN：补齐文档后同一命令通过。
- `git diff --check`。
- 精确密钥和招聘红线扫描。
- Claude + Antigravity 双模型审查。
