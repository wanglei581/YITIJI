# P0-1B 公共终端清场预警与任务感知文案设计

> 状态：待用户审阅
> 基线：`main@b1b68d59`
> 范围：仅 Kiosk 前端安全根、现有 `/session-timeout`、idle/屏保 hooks、扫描 busy 与浏览器回归；不部署。

## 1. 决策

采用“`/session-timeout` 路由预警 + `KioskPrivacyGuard` 统一安全动作”的方案。

- 普通 idle 与已启用屏保的 idle 都在实际清场前进入现有 `/session-timeout` 30 秒倒计时页。
- “继续使用”只安全返回来源页面，并依靠该次明确触控重置 ordinary idle 与硬隐私计时。
- “立即退出”与普通 idle 倒计时结束调用 Guard 的 `hardClear()`；不得由页面自己执行普通 `logout + navigate`。
- 屏保倒计时结束调用 Guard 的 `clearToScreensaver()`：先同步清本地敏感状态、退出会员、建立 privacy boundary，再进入 `/screensaver`。
- 不给硬隐私截止增加预警或延期。硬截止、可见性恢复超时和 BFCache 恢复继续直接 fail-closed `hardClear()`。

## 2. 方案比较

### 方案 A：路由预警 + Guard Context（采用）

复用既有页面和视觉锚点，清场动作集中在安全根。预警 history entry 不复制任何来源 location state；Guard 只在当前 React 内存 ref 中保留原 history entry 和屏保播放列表，不把 token、文件内容、controlToken 或个人数据写入新的 history state。

### 方案 B：SessionTimeoutPage 自行 logout/navigate（否决）

无法执行敏感状态同步清理、privacy boundary、forward 截断和硬刷新，浏览器 back/BFCache 可能恢复上一位用户状态。

### 方案 C：Guard 内 overlay（否决）

能保留原页面 DOM，但不符合已明确的“复用 `/session-timeout` 页面”要求，并会在安全根继续堆视觉职责。Antigravity 的绝对时间倒计时、防触控穿透和大按钮建议保留，但不采用 overlay 架构。

## 3. 状态流

### 3.1 普通 idle

1. `VITE_KIOSK_LOGOUT_IDLE_SEC` 表示从最后一次操作到自动清场的总时长。
2. 正常配置的有效预警时长为 `min(30 秒, ordinary idle 总时长)`。为避免 0ms timer 早于 Guard mount，trigger 至少为 1ms；配置值不大于 30 秒时在下一个宏任务近似立即显示预警，倒计时使用 `总时长 - trigger`，最终截止仍严格等于配置总时长。
3. 通用 `useIdleTimer` 在回调中提供原计划触发时间；Guard 据此计算最终绝对截止 `deadlineAt = plannedWarningAt + effectiveWarningMs`。若后台节流导致回调恢复时已越过 `deadlineAt`，直接清场，不重新赠送完整倒计时。
4. 预警页只依据 `deadlineAt - Date.now()` 计算剩余秒数，避免 React Strict Mode 或后台节流造成双倍/漂移。
5. Guard 发起预警前记录当前 history entry 的 index，仅在内存 ref 中保存恢复信息；预警路由不携带该 state。React Router 的 `history.state.idx` 是既有内部耦合，任何非 number 或不相邻情况都必须 fail-closed，不能猜测恢复路径。
6. 点击“继续使用”只在确认当前 warning 与原 entry 相邻、内存 ref 仍有效时执行 `navigate(-1)` 回到原 entry，因此扫描 controlToken、面试 accessToken 等既有 router state 不被复制也不丢失。
7. 预警页刷新、直接访问、history index 不匹配或内存 ref 丢失时，不尝试恢复来源页面，fail-closed 清场回首页。
8. 点击“立即退出”或倒计时归零调用 Guard `hardClear()`，最终得到干净首页与新的 privacy boundary。

### 3.2 屏保 idle

1. `idleTimeoutSec` 同样表示从最后一次操作到进入屏保的总时长。
2. 在 `idleTimeoutSec - 30 秒` 时进入同一预警页；清场目标和当前公开播放列表只保存在 Guard 内存中，不复制到 warning history state。
3. 继续使用返回来源页面；结束时执行 `clearToScreensaver()`。
4. `clearToScreensaver()` 与硬清场共用一次性 claim，避免倒计时与硬截止双触发；清场后建立 boundary，再导航屏保。
5. claim 与现有 `clearingRef` 合并为唯一的 `clearingModeRef: null | 'hard' | 'screensaver'`，所有清场入口先原子 claim；不存在第二个可绕过 claim 的 clearing ref。屏保清场 claim 后先显示最高层清场遮罩，同步清本地状态与会员态，写入 boundary，并在同一事件交接中用携带该 boundary 的 route state 导航；过渡期间 stale-history 与硬截止都只能观察同一 claim，不能启动第二次清场。
6. Guard 观察到 `/screensaver` 且 route state 的 boundary token 与 `boundaryRef` 一致后，才撤下遮罩并释放 `screensaver` claim；屏保页既有退出/唤醒边界逻辑保持不变。若 token 不一致或播放列表失效，fail-closed 回干净首页。

### 3.3 硬隐私截止

- 保持现有独立计时器，不依赖 ordinary idle、屏保、busy 或预警页面。
- 达到 `VITE_KIOSK_PRIVACY_IDLE_SEC`、可见性恢复发现超时、或 `pageshow.persisted` 时直接 `hardClear()`。
- 唯一的 `clearingModeRef` claim 保证硬截止、软预警倒计时与屏保交接竞态时只有一个清场动作获胜。
- 不要求 `privacy idle > ordinary idle + warning`。若硬隐私配置早于或等于普通路径的最终截止，硬清场直接获胜；软预警不得延长或覆盖硬截止。

## 4. 任务感知文案

Guard 向预警 Context 只暴露不含敏感数据的展示 descriptor（来源 pathname 分类、exitTo、deadlineAt）；预警页据此选择辅助说明：

- `/print/*`、`/scan/*`：`后台任务继续，终端页面将清除`；补充“清场不会取消已创建的打印/扫描任务”。
- `/assistant`、`/resume/*`、`/interview/*`：`未保存的填写内容或练习内容会清除`。
- 其他页面：通用“登录状态和本机临时会话将清除”。
- `user === null`：固定显示“匿名任务退出后无法恢复”；不得暗示可以从“我的”找回。

底部合规说明改为：真实短时 busy 会延后普通预警，但硬隐私上限仍会直接清场；后台打印/扫描任务继续运行。

## 5. 触控与视觉

- 继续使用为主按钮，立即退出为次按钮；触控高度不小于 72px，间距不小于 24px。
- 保留现有青绿米纸、倒计时环与 `data-kiosk-screen="session-timeout"`，不重做首页或新增入口。
- 1080×1920 必须无横向/纵向业务内容溢出；弹层页阻断触控穿透。
- 倒计时必须有文本，不仅依赖颜色或圆环。

## 6. ScanProgress 条件 busy

`ScanProgressPage` 从无条件 `useBusyLock(true)` 改为真实状态驱动：

- 缺少 `scanTaskId` 或 `controlToken`：不持锁，立即返回 `/scan/start`。
- 已取得有效任务身份且状态为 waiting/processing/未知网络重试：持锁，避免普通 idle/屏保打断真实扫描。
- 后端返回 completed/expired/failed/cancelled 或用户明确取消：先把本地状态置为终态释放锁，再导航。
- Guard 隐私清场导致组件卸载：只停止轮询并释放锁，不发送 DELETE/取消请求。

网络错误时任务真实状态未知，仍按“可能运行中”持锁；硬隐私截止依旧能直接清场。

## 7. 组件边界

- `KioskPrivacyGuard.tsx`：保留 boundary/hardClear，新增软预警导航、屏保清场与一次性 claim。
- `KioskSessionControlContext.tsx`：只暴露非敏感 warning descriptor、`continueSession`、`hardClear`、`clearToScreensaver`；来源完整 location 与 playlist 保留在 Guard 私有 ref 中。缺 Provider、ref 丢失或 history index 不匹配时 fail-closed，不静默恢复路径。
- `useIdleTimer.ts`：回调提供原计划触发时间，使上层能在节流恢复后按绝对时间 fail-closed；现有无参数回调保持兼容。
- `useIdleLogout.ts`：按“总 idle 时长减有效预警时长”触发，排除 `/session-timeout` 与 `/screensaver`。
- `useScreensaverController.ts`：只负责配置、缓存和 idle 信号，把播放列表交给 Guard；不自行清场导航。
- `SessionTimeoutPage.tsx`：显示倒计时与任务感知文案，消费 Context；允许读取 `useAuth().user`，但禁止解构/调用 `logout`，禁止自行 `navigate('/')` 冒充安全清场，并由静态门禁防回退。
- `ScanProgressPage.tsx`：维护有限的 active/terminal 状态，始终调用 hook 但传入 `useBusyLock(hasValidTask && phase === 'active')`；不得按条件调用 React hook。

不修改后端 API、数据库、Worker、Terminal Agent、共享 DTO 或硬件协议。

## 8. TDD 与验收

新增独立 warning Playwright 配置，使用短 ordinary idle、短 warning 与较长 hard deadline，避免削弱既有硬截止套件。先写以下失败用例，再实现：

1. 普通 idle 在清场前进入 `/session-timeout`。
2. 继续使用返回来源页，会员态和本地会话未被清除。
3. 立即退出执行完整 hardClear，back/forward 不恢复来源页。
4. 倒计时结束执行完整 hardClear。
5. 屏保 idle 先预警，结束后清场进入 `/screensaver`，唤醒为干净首页。
6. 打印/扫描、AI/面试、匿名三类文案准确；匿名打印/扫描不得出现“已保存到我的”或“可恢复”。
7. 预警页按钮在 1080×1920 高度不小于 72px且无溢出。
8. ScanProgress 缺任务身份不持锁；waiting/网络重试持锁；终态释放。
9. 隐私清场卸载扫描页后停止轮询，且卸载路径不执行 `handleCancel`、不发送 DELETE。
10. 既有 hard privacy 套件继续证明 busy、visibility、BFCache、back/forward 均无法绕过硬截止。

回归至少执行：warning E2E、privacy 18/18、truth 23/23、W2/W5/W6、Kiosk typecheck、lint、生产 build 与相关静态真实性门禁。

## 9. 风险与约束

- 预警页刷新、直接访问或 Guard 内存恢复 ref 丢失：不把 pathname 恢复冒充为原任务，清场目标默认 hardClear，倒计时使用不超过 30 秒的安全默认值。
- 警告倒计时与硬截止同时到达：Guard 的单一 `clearingModeRef` claim 幂等；尚未 claim 时硬截止直接执行，已有屏保 claim 时由已开始的同步清场继续完成，不等待页面动画也不重复清场。
- 屏保配置在预警期间变化：使用触发预警时的已验证播放列表；若列表无效，fail-closed 回干净首页。
- 不以“优化体验”为由延长硬截止、保留匿名 access token 或恢复未保存匿名任务。
- 来源 pathname 只用于内存中的提示分类，不用于重建任务或导航；继续使用只能返回 Guard 记录且 history index 匹配的原 entry，清场动作和 boundary 不信任展示 descriptor。

## 10. 双模型意见处理

- Claude Opus 4.6：推荐路由 + Guard Context，指出页面自行 logout 会绕过安全边界；采纳。
- Antigravity：建议绝对时间倒计时、顶层触控阻断与 72px 按钮；采纳这些实现细节。
- Antigravity 的 overlay 主方案与硬截止前增加可延期预警，不符合用户明确范围及 P0-1 安全不变量；不采纳。

## 11. 文件预算确认

实现预计不超过 13 个文件；`useIdleTimer.ts` 已纳入预算，用于提供原计划触发时间。若实现发现必须超出预算，先回到设计审查，不顺手扩大范围。
