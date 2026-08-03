# P0-1B 需求与范围

## 目标

在 P0-1 已合入的公共终端安全根上，为普通 idle 与屏保 idle 增加 30 秒可见预警；继续使用只恢复当前业务，倒计时结束或主动退出必须复用同一套 fail-closed 清场。硬隐私截止保持独立且不受 busy 或预警影响。

## 用户旅程

1. 普通用户长时间未操作时进入 `/session-timeout`，可继续使用或立即退出。
2. 屏保配置开启时，先预警 30 秒；倒计时结束后清场并进入屏保，触摸屏保回到干净首页。
3. 打印/扫描页面提示后台任务继续、终端页面会清除；AI/面试页面提示未保存内容会清除。
4. 匿名用户明确看到退出后匿名任务无法恢复。
5. 扫描进度页只在后端任务仍可能运行时持有 busy 锁；缺少任务身份或进入终态时立即释放。

## 不变量

- `VITE_KIOSK_PRIVACY_IDLE_SEC` 硬截止不展示可延期预警，不受 busy 抑制。
- 预警页不得自行仅做普通 `logout + navigate`；退出必须经过 `KioskPrivacyGuard` 的安全边界、敏感状态清理、history 截断与硬刷新。
- 隐私清场不得取消已创建的打印或扫描后台任务，只停止当前页面交互和轮询。
- 不新增首页入口、后端 API、数据库模型、依赖或硬件协议。
- 手机扫码登录与手机上传继续保持既有豁免。

## 功能归位与文件预算

- 前端：`apps/kiosk` 的安全根、idle/屏保 hooks、既有预警页与扫描进度页。
- 后端、Worker、Terminal Agent、共享类型、共享 UI：不涉及。
- 文档：本设计、进度与下一步任务。
- 测试：独立 warning 浏览器配置/用例，以及既有 privacy/truth/W2 静态门禁。

预计允许修改不超过 13 个文件：

- `apps/kiosk/src/auth/KioskPrivacyGuard.tsx`
- `apps/kiosk/src/auth/KioskSessionControlContext.tsx`（仅在安全动作需要隔离时新增）
- `apps/kiosk/src/auth/useIdleLogout.ts`
- `apps/kiosk/src/hooks/useIdleTimer.ts`
- `apps/kiosk/src/hooks/useScreensaverController.ts`
- `apps/kiosk/src/pages/placeholders/SessionTimeoutPage.tsx`
- `apps/kiosk/src/pages/scan/ScanProgressPage.tsx`
- `apps/kiosk/playwright.privacy-warning.config.ts`
- `apps/kiosk/tests/visual/kiosk-session-warning.spec.ts`
- `apps/kiosk/package.json`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- 本任务 `.ccg` 文件与设计/计划文档

## 明确禁止

- 不部署、不操作在役终端/打印机/密钥。
- 不把普通 idle 预警混同为硬隐私截止。
- 不在 location/history state 中写 token、文件内容或其他敏感数据。
- 不重做预警页视觉、不扩大到其他页面重构。
- 不用假进度、假任务状态或前端推测冒充后端真值。

## 验收

- 1080×1920 下主按钮不小于 56px，预警文案可读且不溢出。
- E2E 覆盖普通 idle、继续使用、主动退出、倒计时、屏保、任务分类文案、匿名不可恢复与硬截止优先级。
- 既有 privacy 18/18、truth 23/23、W2/W5/W6、typecheck、lint、build 不回退。
- 双模型分析与最终审查均记录真实结果；任一模型不可用时不得伪造批准。
