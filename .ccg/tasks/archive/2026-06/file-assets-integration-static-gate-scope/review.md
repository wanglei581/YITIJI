# 用户文件资产集成计划静态门禁执行范围收口（审查记录）

## 变更摘要

- 将历史集成计划 `docs/superpowers/plans/2026-06-22-file-assets-preprod-integration.md` 中的 `verify:file-assets-trial-acceptance` 拆出为 Step 0 Gate 0 本地静态文档门禁。
- 将 API 文件资产验证步骤明确为 `Run API runtime file asset gates`，该段不再包含 docs-only 静态门禁。
- 在 `verify:file-assets-trial-acceptance` 中新增历史集成计划口径断言，检查：
  - 集成计划必须声明 Gate 0 本地静态文档门禁；
  - 必须声明依赖完整仓库 `docs/`；
  - 必须声明不属于 Gate 3 远端裁剪运行时包命令清单；
  - API runtime gates 段不得包含 `verify:file-assets-trial-acceptance`。
- 同步 `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md`，明确本分支不代表 Gate 2/Gate 3/Gate 4 或生产/试运营执行完成。

## TDD 记录

1. RED：先更新 `verify:file-assets-trial-acceptance`，增加历史集成计划口径断言，运行 `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`，失败信息为 `preprod integration plan must classify verify:file-assets-trial-acceptance as a Gate 0 local docs-only gate`。
2. GREEN：修正历史集成计划、进度入口后，重新运行同一命令通过。

## 验证

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`：PASS
- `git diff --check`：PASS
- 精确密钥与招聘红线扫描：PASS，无命中

## 双模型分析结论

- Antigravity：建议修正历史集成计划，将本地静态检查拆成 Gate 0，再让 API runtime gates 只包含运行时命令。
- Claude：建议只做轻量收口，不重写历史计划；通过正向 marker 与 API runtime section 切片断言防回退。

## 双模型审查结论

- Claude：APPROVE，无 Critical/Major。Info：正向断言与中文文案有意耦合，后续改文案需同步断言。
- Antigravity：APPROVE，无 Critical/Warning。确认 Gate 0 本地静态检查与 runtime gates 已正确拆分，进度文档未越界宣布完成。

## 结论

本分支补齐了历史集成计划的 Gate 0/Gate 3 执行范围防误读口径。未执行预生产或生产远端操作，未上传候选包，未迁移数据库，未重启 PM2，未写 COS、账号或浏览器验收数据。
