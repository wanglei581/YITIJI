# 需求与范围

## 目标

修复 PR #432 的 `kiosk-browser-smoke` 静态门禁失败，使门禁与统一隐私运行时根的既定路由架构一致。

## 修改范围

- `apps/kiosk/scripts/verify-fusion-shell.mjs`
- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/lib/fusion-baseline-contract.mjs`
- `apps/kiosk/scripts/tests/fusion-baseline-contract.test.mjs`
- `apps/kiosk/tests/visual/fusion-smoke.spec.ts`
- `apps/kiosk/scripts/verify-member-login-dialog.mjs`
- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`
- `apps/kiosk/scripts/verify-print-confirm-honest.mjs`
- `apps/kiosk/src/layouts/KioskRuntimeRoot.tsx`（仅修正与现行路由不符的注释）
- 本任务 CCG 归档

## 未修改

- 未修改生产页面、路由或隐私清场行为
- 未新增入口、依赖或业务能力
- 未合并、未部署

## 验收

- `verify:fusion-shell` 通过
- W2–W6 静态合同通过
- Fusion baseline 保持 87 条可导航生产页面；受保护的 `*` 错误边界不计作页面 pattern
- 18/18 隐私浏览器回归通过
- Fusion smoke 的运行时安全根页面使用明确 disabled 屏保夹具，不放行未处理请求
- 打印进度门禁验证仅执行中的真实任务或 SIM 演示持有 busy lock；失败、超时和结束态释放
- 等待 PR #432 CI 复跑
