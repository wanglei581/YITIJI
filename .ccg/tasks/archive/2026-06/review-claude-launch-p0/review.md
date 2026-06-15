# 复核 Claude 上线 P0 方向

日期：2026-06-15

## 结论

Claude 报告的大方向可采纳：项目当前仍应以“上线验收与试运营准备”为主，不应继续堆功能；正式上线前仍不能宣称生产就绪。

但这份清单不能原样执行。当前工作区已经落地了若干 Claude 列为待办的项，继续按原文推进会重复做已完成工作，且“隐藏后台建设中入口”与项目 2026-06-14 已记录的用户拍板方案不一致。

## 仍成立的硬问题

- Kiosk 扫描流程仍在生产路径生成假文件：`apps/kiosk/src/pages/scan/ScanProgressPage.tsx:38-56` 使用 `Math.random()` 生成页数和大小，`apps/kiosk/src/pages/scan/ScanProgressPage.tsx:89-91` 成功路径直接跳转结果页。
- 扫描结果页虽在 http 模式禁用直接打印假文件，但只是 UI 层兜底：`apps/kiosk/src/pages/scan/ScanResultPage.tsx:121-131`。
- Terminal Agent 仍硬编码真实打印机型号并回退使用：`apps/terminal-agent/src/config.ts:6`、`apps/terminal-agent/src/agent/task-runner.ts:313-339`。这违反项目“必须通过 printerName 配置项指定，禁止硬编码型号字符串”的约束。
- Webhook nonce 仍是单实例内存 Map：`services/api/src/sync/replay-guard.ts:18-20`，`services/api/src/sync/sync.service.ts:36-39`。单实例可暂放行，多实例前应改 Redis 或明确禁止水平扩展。
- `COMPLIANCE_FORBIDDEN_TERMS` 只定义未统一接入 CI/ESLint：`packages/shared/src/types/complianceCopy.ts:110-121`。
- 多处自定义按钮/Tab/筛选控件低于 48px，触控体验仍需抽样修。

## 已完成或报告过期的项

- 生产构建禁 mock 已完成：三端 `vite.config.ts` 都有 `assertProdApiMode`，如 `apps/kiosk/vite.config.ts:12-24`、`:35-36`。
- `/qingdao` 已从当前 Kiosk 路由移除：`apps/kiosk/src/routes/index.tsx:55-125` 无 `/qingdao`；历史硬编码金额只保留在旧审计文档中。
- “我的”明细并非仍全是占位：当前已有 4 条 `/me/*` 明细路由，见 `apps/kiosk/src/routes/index.tsx:76-80`，并有对应页面与 API 客户端。
- 腾讯 SMS 不是代码未实现：`services/api/src/member-auth/sms/sms-sender.ts:9-17`、`:123-150` 已实现真实 SendSms + TC3 签名，剩余是模板/签名审核、生产密钥、真号 E2E。
- 后台/Partner 空壳入口仍可见，但当前实现已统一诚实显示“功能建设中”；项目文档记录过用户已拍板“不隐藏入口、不删路由”。因此“必须隐藏侧栏入口”不是当前唯一正确方向。

## 修正版推进顺序

1. 先修真实未清 P0：扫描生产假流程、Agent `printerName` fail-fast 与硬编码回退。
2. 同步做上线验收准备：生产服务器、PostgreSQL、Redis、COS、HTTPS、Windows 真机、短信审核、法务文档。
3. 触控目标按页面抽样收口，优先 Kiosk 高流量路径。
4. Webhook nonce 若预生产/试运营单实例可记录为部署限制；上线多实例前改 Redis。
5. 合规禁词统一门禁建议进入 CI，但优先级低于真实扫描与 printerName。

## 外部 reviewer 状态

- antigravity reviewer 调用失败：本机 `agy` 不在 PATH。
- Claude reviewer 已返回，结论与本地核查一致：方向可采纳，但作为“当前待办清单”已部分过时；生产禁 mock、青岛下线、「我的」明细接真、SMS 真实 SendSms 已在当前分支落地或转为外部验收项。
