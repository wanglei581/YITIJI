# F1 Genesis Task 1：release provenance fixture 拆分

## 真实闭环

为后续 Genesis 离线验证复用临时目录 fixture，同时以既有 verifier 场景证明 `activateRelease` 行为未变。

## 范围

- 允许创建 `services/api/scripts/release-provenance-fixture.ts`。
- 允许修改 `services/api/scripts/verify-release-provenance.ts`，仅将等价 fixture helpers 改为导入。
- 禁止修改运行时代码、CLI、PM2、健康检查、生产/历史 F1、数据库、Agent、Kiosk、打印、部署和业务数据。

## 验收

1. 修改前后均运行 `pnpm --filter @ai-job-print/api verify:release-provenance`。
2. 19 个既有场景、错误码、fixture 内容、固定 manifest 时间和清理语义保持不变。
3. 不访问网络、数据库、Redis、真实 PM2 或真实 health。
4. 完成 Claude 与 Antigravity 双模型审查；有效结论写入 `review.md`。
