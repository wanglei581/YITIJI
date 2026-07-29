# Phase 0 最终 GO/NO-GO 审计

> 审计日期：2026-07-29
> 代码基线：`origin/main@e7d0866ed175efcb9012863cc8d47954f4603202`
> 审计模式：只读生产/真机证据；未部署、未改数据库、未读取或修改密钥、未操作 Windows 与打印扫描设备。
> 正式口径：`docs/device/production-deployment-and-windows-host-checklist.md` §八。

## 一、最终判定

**正式商业上线：NO-GO。**

**当前 `main` 软件候选：NO-GO。** 虽然最新主干 CI、类型检查、生产构建和主要真实性门禁通过，但本轮发现公共终端的闲置清场守卫未覆盖全部路由，并可被永久 busy lock 无限暂停。该问题可能让下一位用户继续查看或操作上一位用户的面试记录、岗位匹配、职业规划、支付/打印/扫描上下文，属于上线前必须修复的 P0 隐私问题。

**单终端免费受控试运营：当前仍为 NO-GO；关闭本文 P0-1～P0-5 后才可重新评估 CONDITIONAL GO。**

| 判定对象 | 结论 | 说明 |
|---|---|---|
| 构建与 CI 完整性 | GO | 当前 commit 的 GitHub CI 三项全绿；本地依赖安全、typecheck、lint、生产构建通过 |
| 软件发布候选 | NO-GO | 存在公共终端跨用户清场 P0；修复并通过安全回归前不可冻结候选 |
| 预发 / 生产部署 | NO-GO | S0-A/B/C 未部署，source→artifact→PM2 发布来源 F1 仍未闭合 |
| 单终端免费试运营 | NO-GO | 法务、精确候选部署、硬件能力白名单、任务级恢复与试运营证据未闭合 |
| 收费商业上线 | NO-GO | 在以上通用 P0 外，还需恢复真实支付并按启用渠道完成现场收款、退款、对账验收 |

## 二、本轮新发现的 P0：公共终端会话清场不完整

### 2.1 顶级全屏路由绕过全局闲置清场

- `/resume/job-fit`、`/resume/career-plan` 与全部 `/interview/*` 是 `KioskRoot` 之外的顶级路由：`apps/kiosk/src/routes/index.tsx:78-91`。
- `KioskBusyProvider`、`useScreensaverController()` 与 `useIdleLogout()` 仅挂在 `KioskRoot`：`apps/kiosk/src/layouts/KioskRoot.tsx:58-88`。
- `KioskFullscreenShell` 只补视觉舞台和导航，不含 idle、logout 或敏感态清理：`apps/kiosk/src/components/kiosk-shell/KioskFullscreenShell.tsx:26-72`。
- `AuthProvider` 位于整个 `RouterProvider` 外层，因此切入上述顶级路由时会员 token 仍保留在内存：`apps/kiosk/src/main.tsx:22-29`、`apps/kiosk/src/auth/AuthContext.tsx:16-91`。
- 顶级路由中的 `useBusyLock()` 因缺少 Provider 会降级为 no-op：`apps/kiosk/src/contexts/KioskBusyContext.tsx:35-59`。

直接影响并非只有屏幕残留：`/interview/reports` 会以当前会员身份读取历史、查看详情并调用真实删除接口；若上一位会员 token 未清，下一位用户会以该残留身份查看或删除上一位用户记录，而不是跨账号任意操作。会员服务端会话约 30 分钟后到期，但到期前仍可被继承；页面 DOM / React 状态在不刷新时没有同等主动清除保证，匿名 AI 任务凭证的生命周期还可能更长。

### 2.2 布局内敏感流程可用 busy lock 无限关闭计时器

- 屏保与公共登出均以 `!busy` 为启用条件：`apps/kiosk/src/hooks/useScreensaverController.ts:61-74`、`apps/kiosk/src/auth/useIdleLogout.ts:42-64`。
- `useIdleTimer` 在 disabled 时完全不计时：`apps/kiosk/src/hooks/useIdleTimer.ts:24-40`。
- 以下页面可能长期或永久持锁：
  - `PrintCashierPage`：`useBusyLock(true)`；
  - `ScanSettingsPage`：`useBusyLock(true)`；
  - `ScanProgressPage`：`useBusyLock(true)`；
  - `PrintProgressPage`：真实任务路径 `!isSim` 始终为 true；
  - `PrintMaterialCheckPage`：只要有文件就保持 busy。

因此用户在支付、打印、扫描或材料检查页离开后，屏保与登出可能永远不触发。后台任务可以继续执行，但前台不应无限展示上一位用户的订单、文件、支付会话或任务状态。

### 2.3 关闭标准

1. 将公共终端安全清场守卫提升到所有路由共享的 Router 根层，不能依赖是否使用 `KioskRoot` 或视觉壳。
2. 保留“业务 idle 不打断真实任务”的能力，但新增不受 busy 抑制的**硬性隐私超时**：到时立即遮罩、清内存认证态与敏感 session，并回到干净入口；后台打印/扫描任务可继续。
3. 覆盖会员与匿名态，清理 Auth token、AI 简历 accessToken、打印材料、岗位材料草稿和路由内敏感状态；本地必须立即 fail-closed，后端登出/撤销应可靠送达并可验证，浏览器后退不能恢复旧 `location.state` 或敏感凭证。
4. 补浏览器回归：全屏岗位匹配、职业规划、面试会话/历史；收银、材料检查、打印进度、扫描设置/进度；验证下一位用户不能读取、删除或继续操作上一位数据。
5. 只有修复后的精确 commit 通过 CI、1080×1920 浏览器回归和公共终端人工复核，才能关闭本 P0。

## 三、最小上线 P0 清单

### P0-1 公共终端硬性隐私超时与跨路由清场

按第二节关闭。该项是当前软件候选本身的代码阻塞，优先级高于继续做页面、后台导航或新增功能。

### P0-2 固定单一候选并闭合发布来源

- 先合入 P0-1，再冻结一个精确 commit；Kiosk、Admin、Partner、API、Agent 均记录 commit / artifact hash / manifest。
- 关闭 F1 D3–D6：source → dist → release → PM2 / 静态资源同源，保留可验证回滚物。
- 当前生产 Kiosk 仍为备案包 `index-DEJ0O4c6.js`（`f2be9a75`），S0-A/B/C 均在其后且明确未部署；不得宣称最新真实性修复已上线。

### P0-3 法务正文与隐私服务承诺一致

- 法务定稿并激活用户协议、隐私政策，包含第三方 OCR / AI、文件分级保存、导出、撤回同意、注销与人工处理口径。
- 登录同意记录必须绑定已激活版本，不再使用 `draft-pending-legal-review`。
- 数据导出 / 注销若首发不开放，协议、页面和客服流程必须明确一致；若承诺开放，则必须完成部署与真实链路验收。

### P0-4 对精确候选完成数据、外部服务与线上浏览器验收

- PostgreSQL：备份 → scratch restore、migration、health、核心 smoke 与应用/数据库回滚演练。
- COS：人工核对生命周期规则并归档截图；不得全桶过期覆盖 `users/` / `long_term`。
- 使用无真实 PII 的合成文件，在目标环境复验当前 OCR、LLM 和启用的语音服务。
- 完成 PostgreSQL + COS + 真实会员账号的用户文件资产证据包；不得以 SQLite / fixture 代替。
- 对已部署精确候选完成线上浏览器登录、AI 简历、岗位/招聘会/政策外跳、文件、打印订单与失败诚实态验收。

### P0-5 Windows 精确候选、关键打印恢复与能力白名单

- 固定 Agent 二进制 hash、版本、ProgramData 配置根、DPAPI / ACL、API 兼容版本。
- 补打印失败、任务级断网、长断网、Agent 重启、打印中断电、状态补报耗尽、恢复后不重印的现场矩阵。
- 只开放已验收能力。USB、TWAIN/ADF、图片、彩色、双面、证件照、证件复印、支付宝等未关闭验收前必须隐藏或明确“未开放”。
- SMB 面板扫描已有真实 PDF 旁证，但不等于扫描整包、TWAIN 或“我的文档”全链验收。

### P0-6 一机一打印机小范围试运营

在 P0-1～P0-5 关闭后，以 1 台终端 + 1 台打印机 + 少量用户执行正式清单 §六；记录故障、任务 ID、日志、人工回退和首日观察。所有阻塞项关闭后再签发正式 GO。

## 四、八大功能当前商用成熟度

| 业务域 | 当前事实 | 上线口径 |
|---|---|---|
| AI 简历服务 | 解析/OCR、诊断、优化、生成、导出和打印核心 API 已接真 | 保留核心主入口；受公共终端清场 P0 约束，模板选择/资产沉淀仍有 P1 |
| 岗位信息 | 已审核来源、企业、详情、AI 解释/匹配和外部跳转接真 | 可作为第三方来源导览；不得记录或宣称平台投递结果 |
| 招聘会 | 列表、详情、企业/岗位、导览、材料与外部预约接真 | S0-A 已移除不可得统计的假 `0`，但修复尚未部署 |
| 打印扫描 | PDF 出纸和 SMB 面板扫描有真机证据，任务/支付/扫描服务代码完整度较高 | 只开放逐项真机通过的能力；整包仍未验收 |
| AI 面试训练 | 创建、作答、语音、报告、打印和历史 API 已接真 | 顶级面试路由的跨用户清场是 P0，修复前不能开放试运营 |
| 政策服务 | 正式政策 API 已接真 | 内置地区指南仍含静态内容，必须展示地区/来源/更新时间，不得宣传全国实时办理 |
| 百宝箱 | 终端级配置、启动治理、事件审计是真实底座 | 默认微应用多为 planned，未配置合作方服务时不能包装成已上线能力 |
| 智慧校园 | 学校/终端开关和扩展 URL 配置壳已接真 | 原生校园内容仍多为静态原型；只展示校方真实配置，不能显示虚假“已开通” |

小程序当前未进入主干运行时，OPC—小程序—Kiosk 联动尚未完成；不能写入首发已完成功能。

## 五、后台与 AI 中台结论

- Admin / Partner / API 的订单、计费、设备、机构、岗位、招聘会、政策、同步、AI 配置与日志主体已接真实 HTTP；生产构建有防 mock 门禁。
- Admin 32→7、Partner 12→6 的信息架构收敛属于 P1 体验优化，**不是当前上线 P0**。上线前大改导航反而扩大回归面。
- 后台不需要推翻重做成“AI 中台”。保留业务运营后台，在其上逐步增加 AI 配置、成本、失败率、质量评估与审计即可。
- 当前“岗位数据质量”不等于“模型输出质量”；后续命名和指标应分开。

## 六、本轮可复验结果

### 通过

- GitHub Actions：`main@e7d0866e` 的 CI run `30384131697` 成功，`build-and-verify`、`postgres-readiness`、`kiosk-browser-smoke` 全绿。
- `pnpm install --frozen-lockfile`：通过。
- `pnpm verify:dependency-security`：通过；未接受的 critical/high 为 0，保留已记录的不可达/本地补丁例外。
- `pnpm typecheck`：9 个工作区项目通过。
- `pnpm lint`：0 error，Kiosk 4 条既有 Fast Refresh warning。
- 按 CI 生产变量执行 `pnpm build`：API、Agent、Kiosk、Admin、Partner 全部通过；首次缺 `VITE_TERMINAL_ID` 构建按设计 fail-closed。
- S0 / 真值静态门禁：打印确认/SIM、智慧校园、W3 简历与面试合约、打印完成、扫描会话、可见操作、招聘会统计 31/31 通过。
- Agent 本地门禁：配置韧性、Windows service recovery、打印扫描安全、scan watcher、scan input health、USB route / token / one-time safeId 全部通过；脚本明确不替代 Windows 真机。
- release provenance fixture、release Genesis fixture、production runtime gates 通过。

### 未通过或未执行

- `test:browser:truth`：15/23 通过；8 条 `scan-session-truth` 失败。共同根因是 2026-07-27 扫描能力门禁新增 `GET /api/v1/terminals/KSK-001/capabilities` 后，该独立套件的 `registerShell()` 未同步 stub；能力状态因而落入“暂不可用”，后续会话断言被门禁挡住。W2/W6 的对应夹具已有该 stub，当前官方 CI 浏览器 job 全绿。结论：这是测试维护缺口，不是本轮观察到的业务断言回归；修复 P0-1 时应一并补齐，不能宣称全部浏览器 truth 套件通过。
- `verify:deploy-data-safety-gate` 在本轮只读环境因未提供 `DATABASE_URL` 主动拒绝运行；该 fail-closed 行为符合设计。最新官方 CI 已在隔离 SQLite/PG 环境通过，本轮未为审计创建或写入本地数据库。
- 未连接生产、PostgreSQL、COS、真实 LLM/OCR、Windows 或硬件，因此没有新增生产/真机通过结论。

## 七、可延期 P1

- Admin 32→7、Partner 12→6 导航分组；合并重复隐私工单入口。
- 修正独立 `scan-session-truth` 能力接口夹具并纳入常规 CI，补公共终端硬清场浏览器套件。
- AI 前后端枚举与日志标签漂移、真正的模型输出质量评价、多模型路由与高风险结果二次审校。
- MSI / 签名安装、TWAIN 一点即扫、证件照、彩色/双面高级参数、小程序联动。
- 若首发保持 FREE_MODE，支付宝和收费支付可延期；一旦对外收费，真实支付/退款/对账立即升级为 P0。

## 八、禁止扩大宣称

- 不得称“Phase 0 已 GO”“正式生产就绪”“可直接商业上线”或“试运营已通过”。
- 不得称 S0-A/B/C 已部署；当前生产 Kiosk 仍早于三项真值修复。
- 不得称所有 8 大功能、USB、TWAIN、ADF、彩色、双面、证件照、小程序联动均已完成。
- 不得把 CI、fixture、静态门禁、预发 API 旁证或单次出纸写成完整生产/真机闭环。
- 不得把 AI 匹配写成录用概率，不得增加平台内投递、收简历、候选人筛选或企业招聘闭环。

## 九、推荐的唯一下一步

**先做“公共终端硬性隐私超时与全路由清场”P0 修复。** 这是当前最小、最高价值、能解除软件候选阻塞的开发任务。完成并通过双模型安全审查后，再冻结新候选、部署和执行 P0-2～P0-6；此时才需要决定 GO 或 CONDITIONAL GO。
