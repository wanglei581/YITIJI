# S0-B 打印 SIM 演示真值收口

## 功能归位声明

- 真实闭环：仅纠正非 HTTP 模式下的打印流程演示表达，不创建真实打印任务。
- 前端：修改既有打印进度页；不新增入口、页面、路由或状态机。
- 测试：扩充既有打印诚实性 verify，并增加一个最小浏览器状态用例（确有必要时）。
- 后端、Terminal Agent、共享类型、共享 UI、数据库、生产配置、支付：均不涉及。
- 文档：完成后更新正式进度与下一步任务。

## 允许修改

- `apps/kiosk/src/pages/print/PrintProgressPage.tsx`
- `apps/kiosk/scripts/verify-print-confirm-honest.mjs`
- `apps/kiosk/tests/visual/fusion-w2-print.spec.ts`（仅当现有构建可达 SIM；分析确认 http-only 后不修改）
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/phase0-s0b-print-sim-truth-20260728/**`

## 必须实现

1. SIM 路径始终可见“演示模式·非真实打印”。
2. SIM 路径不得宣称已支付、终端已接收、文件已校验、打印机正在出纸或已有真实取件结果。
3. SIM 动画可以保留为“流程演示”，结束后不得跳转到会让用户误解为真实任务完成的状态。
4. HTTP + taskId 真实轮询、HTTP 无 taskId fail-closed、Terminal Agent 与支付链路保持不变。
5. 继续满足 27 寸竖屏触控可读性，不新增弹窗或重复入口。

## 禁止事项

- 不改后端、Agent、订单、支付、报价、取件码或数据库。
- 不借机重构整个 `PrintProgressPage`，不新增第二套进度页。
- 不处理简历解析动画；它属于 S0-C。
- 不把 SIM 改名后继续使用真实出纸/支付语义。

## TDD 与验收

1. 先在既有 verify 中增加 SIM 固定提示、禁用真实话术、演示结束态的断言并观察 RED。
2. 最小修改生产页面使同一断言 GREEN。
3. 运行打印相关 verify、Kiosk typecheck/lint/build、既有 REAL Playwright；SIM 另用 mock 模式本地预览做一次浏览器证据，不修改 Playwright 基础配置。
4. Claude + Antigravity 双模型终审；Cursor Grok 4.5 High Fast 复核用户可见文案；Codex 最终决定合并。
