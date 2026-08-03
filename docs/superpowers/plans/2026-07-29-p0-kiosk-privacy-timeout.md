# Kiosk 公共会话硬性隐私超时实施计划

> **目标：** 修复全屏顶级路由绕过公共终端 idle/logout/screensaver 的 P0 隐私漏洞，并保证任何 busy 锁都不能无限保留上一位用户的身份或材料。

## 一、结论与安全不变量

采用“普通 idle + 硬隐私截止”双层模型：

- 普通 idle 和屏保继续尊重真实、短时的 busy，避免正在提交或录音时被轻易打断。
- 硬隐私计时在全部终端业务路由始终启用；它不读取也不服从 busy，达到阈值必须清场。系统休眠或后台节流后，恢复可见时按真实时间差立即补偿判断。
- 清场先提交全屏阻断遮罩，再同步清除会员内存态、匿名材料 session 与页面交互；随后新增带随机边界代次的干净首页 history entry，截断 forward 栈并硬刷新。
- 后端 logout 使用 `fetch keepalive` 尽力送达，但本地清场绝不依赖网络成功。
- 普通 idle 与硬隐私截止都统一进入硬清场；屏保使用 push 截断用户已后退后残留的 forward 栈，并在进入、刷新、唤醒首页时持续携带无 PII 的 boundary。旧 back 项在 Outlet 渲染前 fail-closed，BFCache 恢复也立即清场；不新增 resetBusy API。
- 打印和扫描只停止当前页面轮询，不调用取消接口；后台已创建任务继续运行。
- `/member/qr-login`、`/upload/phone` 是手机辅助入口，不套 27 寸终端硬超时；法律页可能从已登录终端会话进入，必须留在安全根内，不能成为暂停硬截止的逃逸路由。

## 二、路由与运行时结构

### Task 1：先建立失败回归

**新增/修改：**

- `apps/kiosk/playwright.privacy.config.ts`
- `apps/kiosk/tests/visual/kiosk-privacy-timeout.spec.ts`
- `apps/kiosk/package.json`

测试以 1 秒 idle/hard timeout 构建独立 Kiosk，覆盖：

1. 已登录用户进入 `/interview/reports`，能看到本人记录；闲置后回到干净首页，logout 请求带原 token，重新进入报告页不得继续请求本人数据。
2. 匿名用户携带面试 route state 和三项敏感 `sessionStorage` 进入 `/interview/session`；页面 busy 不能压住硬超时，清场后敏感 key 全部为空，浏览器后退不能恢复面试内容。
3. 真实打印或扫描轮询页被硬清场时，只停止前端轮询，不发取消任务请求。
4. `/member/qr-login` 与 `/upload/phone` 等待超过同一阈值后仍停留原页，证明手机入口被明确豁免。
5. 先在未修复源码上执行并记录 RED，再进入实现。

### Task 2：修复既有扫描 truth 夹具

**修改：** `apps/kiosk/tests/visual/scan-session-truth.spec.ts`

- 在公共 shell fixture 中补齐 `GET /api/v1/terminals/KSK-001/capabilities` 的诚实响应。
- 先复现当前 8 个失败，再单跑该 spec，确认不是放宽断言或吞掉未知请求。

### Task 3：建立全终端无视觉安全根

**新增/修改：**

- `apps/kiosk/src/layouts/KioskRuntimeRoot.tsx`
- `apps/kiosk/src/auth/KioskPrivacyGuard.tsx`
- `apps/kiosk/src/routes/index.tsx`
- `apps/kiosk/src/layouts/KioskRoot.tsx`

实施：

1. `KioskRuntimeRoot` 只负责 `KioskBusyProvider`、`KioskPrivacyGuard` 和 `<Outlet />`，不增加视觉容器。
2. React Router 增加 pathless route，把 `/login`、简历定向页、全部面试页、`/screensaver`、会话超时/离线页和现有 `/` KioskRoot 子树统一放入该安全根。
3. 手机扫码登录、手机上传保持顶级并明确不进入安全根；法律页作为无视觉全屏路由进入安全根，但不嵌套 `KioskRoot` 视觉壳。
4. `KioskRoot` 退回纯视觉职责，删除 provider、screensaver 与 idle 控制器，避免重复计时器。
5. `KioskPrivacyGuard` 统一挂普通 idle、屏保和硬截止；硬截止始终启用，普通 idle/屏保可以在更短阈值先行结束会话。
6. 硬截止使用真实时间戳并监听 `visibilitychange`，避免系统休眠/后台节流绕过上限。
7. 所有清场回调以 ref 保证 StrictMode 下只执行一次；立即显示不可交互遮罩，随后清敏感 session、发起 keepalive logout 并 hard replace 首页。
8. 屏保路由使用 replace 进入，避免浏览器后退恢复屏保前的敏感页。

### Task 4：保证登出尽力送达但不阻塞清场

**修改：**

- `apps/kiosk/src/auth/AuthContext.tsx`
- `apps/kiosk/src/auth/useIdleLogout.ts`
- `apps/kiosk/src/hooks/useScreensaverController.ts`
- `apps/kiosk/src/services/auth/memberAuthApi.ts`
- `apps/kiosk/.env.example`

实施：

1. `memberLogout` 为 POST logout 启用 `keepalive`，不修改后端契约。
2. AuthContext 保持“同步本地清空、异步服务端登出”的现有原则。
3. 普通 idle 也调用统一硬清场，不再以 SPA navigate 结束公共会话；屏保进入改为 replace。
4. 增加 `VITE_KIOSK_PRIVACY_IDLE_SEC` 文档项；默认 300 秒，保留现有 180 秒普通 idle/屏保先行，部署可独立收紧。
5. 不清理非敏感的本机收藏/设备 ID；只清现有三类敏感 session、认证内存态和 route/React state。

### Task 5：把 busy 收窄为真实在途操作

**修改：**

- `apps/kiosk/src/pages/auth/LoginPage.tsx`
- `apps/kiosk/src/pages/print/PrintCashierPage.tsx`
- `apps/kiosk/src/pages/print/PrintProgressPage.tsx`
- `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx`
- `apps/kiosk/src/pages/scan/ScanSettingsPage.tsx`
- `apps/kiosk/src/pages/interview/InterviewSessionPage.tsx`

规则：

- Login：删除页面私有 idle 计时器；只在短信登录请求/成功过渡时加 busy。
- Cashier：只在扫码/确认等待、发起支付、提交付款码和主动对账时 busy；失败、关闭、退款、过期释放。
- Print progress：仅真实任务未失败/未超时或模拟任务未完成时 busy。
- Material check：仅 inspection/normalize/pii_scan/submitting 等真实工作态 busy，不因有文件就永久 busy。
- Scan settings：仅创建/确认扫描会话在途时 busy；无效、失败、过期释放。
- Interview：只在 AI 思考/收尾或麦克风授权/录音/转写时 busy；用户阅读与准备回答不锁住普通 idle。
- Scan progress 保持 active-task busy；硬隐私截止负责公共安全，页面清场不得调用 cancel。

## 三、验证顺序

1. `pnpm --filter @ai-job-print/kiosk test:browser:privacy`：RED 后 GREEN。
2. `pnpm --filter @ai-job-print/kiosk test:browser:truth`：恢复 23/23。
3. `pnpm --filter @ai-job-print/kiosk typecheck`
4. `pnpm --filter @ai-job-print/kiosk lint`
5. 生产 HTTP build（显式注入测试用 terminal id 与 TRTC/HTTP 开关，不写入仓库）。
6. W2/W3/W5/W6 聚焦浏览器回归，以及现有 member-session、production-real-services、print/scan truth 静态门禁。
7. 检查 `git diff --check`、依赖审计、无密钥与范围审查。
8. 双模型安全审查与 Cursor Grok 4.5 high/fast 审查；Critical 修复后重跑受影响测试并复审。

## 四、收尾与非目标

- 通过后更新 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`，如实说明仅本地候选分支完成，尚未真机/生产验收。
- 任务归档到 `.ccg/tasks/archive/2026-07/` 并本地提交；未经用户明确批准，不 push、不合并到 main。
- 本轮不新增业务功能、后台 AI 中台、远程会话控制、API、数据库字段、硬件能力或生产配置。
