# 双模型只读分析

## 基线

2026-07-17，`pnpm --filter @ai-job-print/api verify:release-provenance` 通过，输出 19 个 `PASS` 和 `=== ALL PASS ===`。该脚本只使用临时目录 fixture 与 fake runner，不调用真实 PM2、网络、数据库、Redis 或健康端点。

## Claude Opus 4.8

结论：`APPROVE_WITH_WARNINGS`；Critical 0，Warning 2。

- `RELEASE_ID` 与 `GIT_COMMIT` 必须移动为 fixture 模块内的单一来源并导出，避免 verifier 与 fixture 各自定义。
- 所有抽取的 helper 必须导出并由 verifier 回向导入；保留 verifier 自身仍需的 `mkdtempSync`。

## Antigravity Gemini 3.1 Pro (High)

结论：`APPROVE_WITH_WARNINGS`；Critical 0，Warning 1。

- `replaceManifestCopies` 不应永久硬编码默认 release ID；增加可选 `releaseId` 参数（默认仍为共享 `RELEASE_ID`），以便后续 r1/r2 fixture 显式写入对应 artifact 目录。

## 实施决定

新 fixture 模块导出 `Fixture`、`RELEASE_ID`、`GIT_COMMIT` 与六个 helper。`replaceManifestCopies(fixture, mutate, releaseId = RELEASE_ID)` 保持现有调用无行为变化，同时允许后续离线 fixture 指定目标 release ID。
