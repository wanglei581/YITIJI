# Windows 一体机 Agent 升级 + Phase F 复验执行单（2026-09）

> 版本：安装包 `main@5bff1bc42`（CI run `34026906605`）· 线上 API `891492396`（含 #833 可信终端身份总闸门）
> 执行人：____ · 核对人：____ · 日期：____
> 本单是「到了机器旁按序做什么」；通过标准与勾选项仍以
> [production-deployment-and-windows-host-checklist.md §五](./production-deployment-and-windows-host-checklist.md)、
> [windows-field-recheck-phase-f-runbook.md](./windows-field-recheck-phase-f-runbook.md)、
> [production-agent-onboarding.md](./production-agent-onboarding.md) 为准。两边不一致时以被引用文档为准。
> 每项必须记证据（脱敏截图、任务 ID、日志行、时间）；未做的项不画勾。

## 为什么要做这一单

- 线上 API 已于 2026-09-06 17:37 受控发布到 `891492396`，其中 #833 要求 Kiosk 先从本机 Agent 取 60 秒启动票、再向云端换 30 分钟会话令牌；`POST /print/jobs`、`GET /terminals/:id/config`、`POST /terminals/:id/toolbox-events` 三条接口无令牌即 401。
- 终端 `t_ksk_001` 最后心跳 2026-08-31 23:42（北京时间），线上 `isOnline=false`。机器上跑的 8 月版 Agent 没有 `/local/terminal-boot-ticket`，即使开机，Kiosk 建单也会在退避 60 秒后显示「终端安全校验失败，请联系现场工作人员」。
- 2026-07-25 的 Phase F 通过是旧契约下的结论，不能继承。

## 0. 前置与授权

- [ ] 已取得现场执行授权（本机 Windows 主机 + 奔图打印机），知道发布窗口与回滚联系人。
- [ ] 有管理员后台账号，能打开「终端管理」页对 `KSK-001` 做「进入维护 / 生成绑定码 / 恢复运行 / 停用 / 启用」。
- [ ] 安装包已取到（在有 `gh` 的机器上执行，**9 月 13 日产物过期**）：

  ```bash
  gh run download 34026906605 -n terminal-agent-unsigned-installer-candidates -D ./agent-5bff1bc42
  ```

  包内用到：`AIJobPrintTerminalSetup.exe`（首选）、`AIJobPrintAgent.msi`（备用）、`candidate-identity.json`（记录来源提交）。产物**未签名**，SmartScreen 会拦一次，属预期。
- [ ] 测试 PDF：1 页、无个人信息。
- [ ] 不用本单练 close-unpaid、退款或「紧急吊销凭证」；不把绑定码、Agent token、桥接令牌贴进聊天、工单或仓库。

## 1. 动手前盘点（只读，全部记回执）

在一体机用**管理员 PowerShell**：

```powershell
Get-Service | Where-Object { $_.Name -match 'AIJob|PrintAgent|Terminal' } | Format-List Name, DisplayName, Status, StartType
sc.exe qc aijobprintagent.exe
```

- [ ] **A1 安装方式**：看 `BINARY_PATH_NAME`。指向 `C:\Program Files\AIJobPrintAgent\...` 记「EXE/MSI 安装」；指向仓库目录 `...\apps\terminal-agent\...` 记「仓库目录运行」（2026-07-27 回执是后者）。这决定第 2 节走 2A 还是 2B。
- [ ] **A2 配置位置**：`%ProgramData%\AIJobPrintAgent\agent-config.json` 是否存在；仓库目录 `apps\terminal-agent\config\agent-config.json` 是否存在。只看 `terminalId` / `terminalCode` / `printerName` / `apiBaseUrl` 四个字段，**不要打开或复制 `agent.token`**。
- [ ] **A3 打印机真实名**：

  ```powershell
  Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | Format-Table -AutoSize
  ```

  记下名字，后面绑定向导里按序号选它。红线：代码和配置只能走 `printerName`，不得硬编码型号。
- [ ] **A4 本机打印队列为空**：`Get-PrintJob -PrinterName "<A3 记下的名字>"` 无结果。
- [ ] **A5 云端无在途任务**：管理员后台订单页确认 `KSK-001` 没有 `pending / claimed / printing`。有的话先处理完，否则第 2 节的「进入维护 → 生成绑定码」会被 `TERMINAL_IN_FLIGHT_TASKS` 拒绝。
- [ ] **A6 为什么 8 月 31 日之后没心跳**：看服务当前状态和 `%ProgramData%\AIJobPrintAgent\logs\` 或仓库目录日志最后几行，把原因写进回执（关机、服务停了、断网、其他）。这是独立问题，升级不会自动解释它。

## 2. 升级 Agent

### 2A 仓库目录运行 → 换成 EXE 安装（当前预期路径）

1. 停并卸载旧服务（在仓库 `apps\terminal-agent` 目录）：

   ```powershell
   node dist\index.js uninstall-service
   Get-Service | Where-Object { $_.Name -match 'AIJob|PrintAgent|Terminal' }
   ```

   期望第二条为空。若 `uninstall-service` 报错，用 `sc.exe stop aijobprintagent.exe` + `sc.exe delete aijobprintagent.exe`，并把报错原文写进回执。新旧服务 SCM 名相同，**不清掉旧的不能装新的**。
2. 管理员后台「终端管理」→ `KSK-001` → **进入维护**（填操作原因）。已激活终端只有在 `maintenance` 下才允许生成换机绑定码。
3. 同页 → **生成绑定码**。明文只显示一次，记在纸上，不截图外发。
4. 双击 `AIJobPrintTerminalSetup.exe` 安装。装完服务应为 Stopped / Manual，这是设计如此（未绑定前 fail-closed）。
5. 开始菜单「AI Job Print Terminal」→ 运行 `provision\provision-terminal.cmd`（或安装目录 `C:\Program Files\AIJobPrintAgent\provision\provision-terminal.cmd`）。向导会：列出打印机让你按序号选（选 A3 那个）、提示输入绑定码、把 API 固定为 `https://zyidai.cn/api/v1`、把 Kiosk 来源固定为 `https://zyidai.cn`、DPAPI 保存 token、收紧 ProgramData ACL、启动服务并校验心跳。
   - 绑定成功会使云端 `credentialGeneration +1`，旧 token 立即作废。这正是想要的：机器上只剩一份凭证。
   - 报 `TERMINAL_MAINTENANCE_REQUIRED`：第 2 步没做。报 `TERMINAL_IN_FLIGHT_TASKS`：回到 A5。
6. 管理员后台 → `KSK-001` → **恢复运行**。在途任务不为 0 会被拒，先排空。
7. 若之前启用过 U 盘 / 扫码桥接令牌，按 [production-agent-onboarding.md](./production-agent-onboarding.md) 用 `configure-local-bridge-token.ps1` 重配；本单不验 U 盘。

### 2B 已是 EXE/MSI 安装 → 同机升级

1. 管理员后台 → **进入维护**，确认在途任务 0（升级不得覆盖运行中的 Agent，这是 MSI 设计 §4.2 的硬要求）。
2. 双击新的 `AIJobPrintTerminalSetup.exe`。Major Upgrade 保留 `%ProgramData%` 下的配置、DPAPI token、SQLite，**不需要重新绑定**。
3. `Get-Service aijobprintagent.exe` 为 Running；不是就 `Start-Service aijobprintagent.exe` 并看日志。
4. 管理员后台 → **恢复运行**。

### 2C 升级后即时核对（两条路径都做）

- [ ] 服务 Running + Automatic（或符合现场策略）。
- [ ] 本机回环只听 127.0.0.1：

  ```powershell
  netstat -ano | findstr LISTENING | findstr ":9527"
  ```

- [ ] 新版特征接口存在（**不带 Origin、不带查询串、空 body**，这是给看门狗用的）：

  ```powershell
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:9527/local/terminal-boot-ticket" -TimeoutSec 4 | ConvertTo-Json
  ```

  期望：`success=true`，`data.bootTicket` 为 32 到 128 位字符串，`data.expiresInSeconds=60`。旧版 Agent 这里是 404，这就是新旧的分水岭。票 60 秒过期且一次性，这张测试票不会被复用，不用管。
- [ ] 从 Mac 只读旁证（本机 `*.sslip.io` 被劫持，公网一律 `--resolve`）：

  ```bash
  curl -s --resolve zyidai.cn:443:120.48.13.190 https://zyidai.cn/api/v1/terminals/t_ksk_001/printer-status
  ```

  期望 `isOnline=true`，`lastSeenAt` 为当前时间，`printerStatus=ready`。
- [ ] 管理员后台终端行显示在线；「版本观察」若有计划则显示 `0.4.11`，没有计划显示「版本未验证」也算正常（那只是版本字符串对照，不是制品验真）。

## 3. Kiosk 看门狗

- [ ] 查现有计划任务：`Get-ScheduledTask -TaskName AIJobPrintKioskWatchdog`。没有则注册（管理员 PowerShell）：

  ```powershell
  & "C:\Program Files\AIJobPrintAgent\kiosk\register-kiosk-watchdog.ps1" -Url https://zyidai.cn/ -StartNow
  ```

  或在「终端控制中心」窗口点「注册 Kiosk 看门狗」。计划任务只带公网 URL，不带任何凭据。
- [ ] 已有旧任务的：旧任务指向的是旧 `kiosk-watchdog.ps1` 路径吗？`(Get-ScheduledTask AIJobPrintKioskWatchdog).Actions` 看 `-File` 参数。指向仓库目录或旧安装目录就先 `-Unregister` 再重新注册，否则拉起的浏览器永远没有票。
- [ ] 看门狗日志 `%LOCALAPPDATA%\AIJobPrintKiosk\watchdog.log` 最新一行应为：

  ```text
  started kiosk browser pid=... exe=... bootTicket=True
  ```

  `bootTicket=False` 表示取票失败，往上翻 `boot ticket attempt N failed` 看原因，回到 2C。

## 4. Phase F 复验（新契约）

### 4A. 交给 Mac/Claude 的上线前问题单（先修复，再做 Windows 真机）

#### Mac 侧核对结论（2026-09-06，逐条对代码与线上）

| 问题单结论 | 核对结果 | 证据 |
|---|---|---|
| 线上仍是旧 UI，需先部署 106 路由新版 | **不成立**。线上就是 main `891492396`（deploy run 34024303135，kiosk bundle `assets/index-CC6VWakW.js`），无更新的前端可发；「新版」指 51 页迁移，当前 1/51 | `docs/progress/next-tasks.md` 主线表 |
| claim 出现 429 | **根因已定位，修复中**：安装脚本默认 `ClaimIntervalMs=1000` × claim 端点每台 30 次/分钟；Agent 不识别 429 | `install-production-agent.ps1:69`、`terminals.controller.ts:173`、`task-runner.ts` catch 分支；分支 `fix/claim-rate-limit-429` |
| 单飞机制无并发但缺真机证据 | 代码层已有自动化证据（`verify:task-runner-wake` 在 CI）；真机矩阵按下文执行 | `task-runner-control.ts` |
| `Printing, Retained` 不能当已出纸 | **已实现**：retained 视为不确定态，查 PrintService 完成事件，超时 `PRINT_JOB_UNCONFIRMED`、不自动重印 | `wmi.ts:369-377`、`task-runner.ts:718`、门禁 `verify:print-monitor-truth` |
| 彩色/扫描/复印按证据分层 | **已实现**：`PrintConfirmPage` 按本机 `TerminalCapability` 收口并明示未验证；开放 API 彩色仍无 wire value | `PrintConfirmPage.tsx:162,533`、`packages/shared/src/types/print.ts:100` |
| 连续 5 单/突发/耐久未验证 | 同意，等 429 修复部署后执行下文矩阵 | 本节 |

#### UI 发布基线

- 当前线上 `zyidai.cn` / `admin.zyidai.cn` 仍可能展示旧版前端；Windows 侧不能用线上旧页面判断 Mac 侧 106 路由的完成情况。
- Mac/Claude 需要把已完成的 106 路由前端构建部署到目标线上环境，并提供：部署提交 SHA、三端实际访问 URL、构建时间、浏览器验证结果。Windows 侧只在确认浏览器加载的是该 SHA 后做真机打印验收。
- 发布前逐项核对现有入口、按钮和空态，避免因为旧线上 bundle 缺少按钮而把“前端未发布”误判为“打印机能力缺失”。不新增重复入口；沿用既有打印/扫描服务中心和打印参数页。

#### 打印能力按钮与真实能力边界

- 奔图 CM2820ADN 硬件已知具备彩色打印、扫描、复印；但《开放打印能力.pdf》V1.0 只定义云 API 的设备注册、打印任务、状态和回调，没有彩色 `mode` 的 wire value，也没有扫描/复印 API。
- Mac/Claude 需要把按钮和状态按证据分层：
  - 已有本地 Windows 链路且本轮可以验证：黑白打印、单面打印、PDF/图片打印。
  - 硬件具备但系统链路尚未接通：彩色打印、扫描、证件复印。可以展示“设备支持/待现场开通”或禁用态，但不能伪造任务成功、价格、记录或云端扫描能力。
  - 双面、纸盒、份数、纸张类型等只有在本地驱动实际验证后才可开放给用户；云 API 规格中的字段不能替代 Windows 真机证据。
- 彩色按钮不得默认发送 `mode: "color"`。在厂家书面确认 wire value 前，开放 API 路径保持不可用；本地驱动彩色是否可用单独通过 Windows 真机验证。
- 所有按钮点击都必须有真实状态反馈：设备离线、缺纸、卡纸/设备故障、任务排队、打印中、完成、结果未确认。不能仅因 `pdf-to-printer` 返回成功就显示“已出纸”。

#### 连续多订单打印的修复要求与验收结论

- 当前候选 Agent 已有 `task-runner-control` 的单飞控制：claim 周期和 wake 请求共用锁，`maxTasks=1`，并等待一单的 `executeTask()` 完整结束后才进入下一轮。因此“必然并发串单”目前不是已证实缺陷，但仍未有连续不同订单的 Windows 真机证据。
- Mac/Claude 需要在合入前补齐并保留自动化证据：单台终端同一时间最多一个打印生命周期；异常、重启、状态回传失败和 wake/定时器同时触发都不能重复派发；后端 claim 继续以终端和任务状态做幂等兜底；终端日志、云端状态和 Windows 队列可用同一 `taskId` 对账。
- 已观察到 claim 端点 HTTP 429，单次现场约延迟 4 分钟才领取成功。Mac/Claude 需要查清限流窗口和触发维度，处理 `Retry-After`（无该值时指数退避 + 随机抖动），并证明 429 不会把任务误判为失败、不会重复 claim，也不会让队列长期积压。
- `Printing, Retained` 不能单独作为完成证据。若 Windows 队列监控在超时前未观察到明确完成事件，必须进入 `PRINT_JOB_UNCONFIRMED`，提示现场核查并禁止自动重印；需要补充连续任务下的队列观察和 PrintService 事件对账。

#### Windows 侧连续打印验收矩阵

Mac/Claude 修复并部署候选版本后，现场至少执行以下四组；任一组失败即暂停，不把“第一单能出纸”扩展为连续打印通过：

1. **顺序组**：5 个不同的一页 PDF，内容分别标识 A/B/C/D/E，逐单提交。验证每单只出 1 页、顺序一致、无串单，状态均为 `pending → claimed → printing → completed`，队列最终为空，临时文件清理。
2. **突发组**：5 个任务在 10 秒内提交。验证 Agent 串行出纸、无重复/漏打、没有任务永久停在 `claimed` 或 `printing`，后台与页面状态一致，并记录每个 `taskId` 的领取和完成时间。
3. **格式与参数组**：混合 PDF/JPG/PNG；黑白任务先验收。彩色、双面、份数、纸张类型必须逐项记录为“通过/未验证”，不能用黑白单面结果代替。
4. **耐久与恢复组**：连续 10 至 20 个小任务，观察卡纸、缺纸、队列卡死、CPU/内存持续升高、429 重试、临时文件残留；再分别做断网恢复、Agent 重启、打印机重启、补纸和 Print Spooler 恢复。出现“后台完成但无纸”“有纸但后台失败”“数量不符”“顺序错乱”时立即停止，保留 `taskId`、时间、队列状态和脱敏日志。

完成标准：只有上述证据齐全且每项通过，才能对外说“连续打印已验证”。单次 F3 通过只能证明一张黑白单面测试页曾经真实出纸。

### 4B. 结果层新增打印路径的真机项（2026-09-07，简历优化主会话委托；Mac 侧只能跑到 Playwright 与门禁，出纸必须真机）

三条都是「一体机上点导出 → 走既有打印链路 → Agent claim → 出纸」，只用本人测试数据，纸面不含他人个人信息。每条记 taskId、订单号、出纸照片（可打码）。

**先看线上版本再动手**：这三条端点都在 #851/#866 之后才进 main，线上 API `1b2195adf`（2026-09-06 22:51 发布）**没有**这两个控制器。API 发布到含它们的提交之前，一体机上点导出只会 404 或看不到入口，**不要在那之前做本节**，做了也只能记「线上未含该版本」。Mac 侧发布后会在 `current-progress.md` 记发布 SHA 并通知。

| # | 路径 | 真机判据 | 后端事实（origin/main 已核） |
|---|---|---|---|
| 1 | AI 诊断报告 PDF 与「修改清单」PDF 出纸 | 两份都能建单并真实出纸；中文不缺字、不方块 | `POST /resume/records/:taskId/export`（`resume-report-export.controller.ts`）；服务端生产启动自检要求中文字体，服务器已装 `NotoSansCJK-Regular.ttc` |
| 2 | 优化 / 生成预览页导出的简历 PDF 出纸 | 出纸成功；**纸面电话、邮箱是全量原文**（屏幕上掩码、文件里不掩码是设计），如实记录纸面内容是否与设计一致 | 同上导出链路 |
| 3 | Word → PDF 转换产物出纸；签约风险报告不论转不转都不得出纸 | 转换产物能建单出纸（若线上 `CONVERSION_ENGINE` 为 disabled，则记「转换未开放，页面提示诚实」，不算失败）；对签约风险报告点打印必须被服务端 400/403 拦下（错误码含 `CONTRACT_REPORT_FORBIDDEN`），Agent 日志无该任务的 claim | `POST /files/:id/convert`（`document-conversion.controller.ts`）；引擎未声明时默认 `disabled`；合规边界 §4.8 |

**发布时序约束（下一次 API 发布前，卡在 Mac 侧）**：main 自 #860 起，`NODE_ENV=production` 启动自检无条件要求可用中文字体（`PRODUCTION_CJK_FONT_MISSING` 拒绝启动，与转换引擎无关）。2026-09-07 00:50 只读核过：服务器已有 `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc` 与 `wqy-microhei.ttc`，探测会过。转换引擎按 checklist 第 124–132、153、163 行，未装则在 `.env` 显式写 `CONVERSION_ENGINE=disabled`（当前未声明，代码默认 disabled）。Agent 侧不装任何转换引擎，仍只收 PDF / 图片。

**发布后必留的线上证据**：管理员登录后请求 `GET /api/v1/health/cjk-font`，把 `data.ok`、`path`、`family` 三个值抄进回执。这是 #860 字体自检唯一的线上证据，`health` 返回 `ok` 不能替代。

**发布窗口协作规则（2026-09-07 与简历优化主会话约定）**：开闸前至少 10 分钟通知该会话并等它回复确认（它会杀掉自动合并脚本）；未确认不开闸；发布完成或闸门关回后再发「闸门已关 / 发布完成」。

### F1 服务与驱动名

- [ ] `Get-Service aijobprintagent.exe`：Running / Automatic。
- [ ] `%ProgramData%\AIJobPrintAgent\agent-config.json` 的 `printerName` 与 A3 完全一致。

### F2 Kiosk 会话建立

- [ ] Kiosk 全屏页正常进入首页，地址栏（若能看到）**不含** `boot_ticket=`（页面兑换后会用 `history.replaceState` 抹掉）。
- [ ] 进到打印确认页：按钮不是「安全校验中…」也不是「终端安全校验失败」，页面无黄色告警条。
- [ ] 首页设备状态显示在线 / 就绪（允许首帧「检查中」）。

### F3 真机出纸（受控 1 页）

- [ ] 走 Kiosk 既有上传或扫码上传路径，打 1 页无个人信息 PDF（FREE_MODE 下 0 元）。
- [ ] 任务 `pending → claimed → printing → completed`，纸真出来，`Get-PrintJob` 队列空。记 `taskId`、订单号、耗时。
- [ ] 不为验收造未支付 pending 单。
- 今日不便出纸：回执写「F3 跳过：原因」，本单不得标通过。

### F4 停用即拒（吊销验证，不动凭证）

- [ ] 管理员后台 → `KSK-001` → 关闭「启用」开关（确认弹窗）。
- [ ] Kiosk 上再点一次建单：应立即显示「终端安全校验失败，请联系现场工作人员」，**不**转圈 60 秒（#833 评审已把业务 401 从可重试里拆出来）。
- [ ] 后台重新打开「启用」。会话令牌未被轮换，无需重新绑定。
- [ ] 关掉 Kiosk 浏览器窗口（或 `taskkill /IM msedge.exe /F`），看门狗 3 秒内带新票重新拉起，重复 F2。
- 说明：不要用「紧急吊销凭证」做这一项。它会把终端转为「已暂停」并作废 token，之后必须重走 2A 第 2 到 6 步。

### F5 Agent 掉线自愈（无人值守场景）

- [ ] `Stop-Service aijobprintagent.exe`，然后关掉 Kiosk 浏览器。
- [ ] 看门狗日志出现 `boot ticket unavailable after automatic retry window; launching without ticket`，浏览器仍被拉起，打印确认页显示「终端安全校验失败」。这是 fail-closed，不是故障。
- [ ] `Start-Service aijobprintagent.exe`。**不碰浏览器**，30 秒内日志出现 `local Agent is reachable again; restarting ticketless kiosk browser with a boot ticket`，浏览器自动重启，重复 F2 通过。记从启动服务到页面可用的秒数。

### F6 断网恢复（约 3 分钟）

- [ ] 拔网线或断 Wi-Fi 60 到 90 秒。Mac 侧 `printer-status` 的 `lastSeenAt` 停更或 `isOnline=false`。
- [ ] 恢复网络，不重启服务：心跳恢复，`isOnline=true`。
- [ ] Kiosk 页在断网期间点建单应得到中文提示，不是原始英文错误。
- [ ] 网络恢复后再点建单。两种结果都要如实记：① 直接能建单；② 显示「终端安全校验失败」。② 是代码里已知的口子：断网期间若恰好撞上 10 分钟主动续签或某次 401 刷新，60 秒退避耗尽后会话进入 `failed`，页面不会再自动恢复，看门狗也不会重启它（它只盯无票启动的浏览器）。现场处理：关掉浏览器让看门狗带新票重拉。出现 ② 就在回执里写明断网时长与是否点过建单，回来定是否要补自动恢复。

### F7 Kiosk 全屏抽查

- [ ] Edge/Chrome Kiosk 全屏无系统弹窗阻断主路径；无 SmartScreen 或更新提示残留。

## 5. 可选：小程序到出纸闭环（B3）

时间允许再做，按 [next-tasks.md](../progress/next-tasks.md)「B3 Windows + 奔图真机验收」的口径：小程序建单 → 到机码或扫码 → 支付 → Agent claim → 出纸 → 进度回流；覆盖错码、错终端、未支付、过期、连点不重复出纸。这条走 Agent 的 claim 接口，#833 没改它，但也没在新版 API 上验过。留 orderId / taskId / 出纸照片。

## 6. 回执模板

```text
WINDOWS AGENT 升级 + Phase F 复验回执（2026-09）
安装包：5bff1bc42 / run 34026906605 / candidate-identity.json 已核对 = 是|否
A1 安装方式：仓库目录|EXE/MSI    A6 8/31 后断心跳原因：____
2 升级路径：2A|2B   绑定：成功|失败（错误码）   恢复运行：是|否
2C boot-ticket 接口：200 + 60s = 是|否   printer-status isOnline=true：是|否
3 看门狗：任务已注册 = 是|否   watchdog.log bootTicket=True = 是|否
F1 服务 Running/Automatic：是|否   printerName 一致：是|否
F2 Kiosk 会话就绪：通过|失败
F3 真机出纸：通过（taskId ____）|跳过（原因）
F4 停用即拒 + 启用后恢复：通过|失败
F5 Agent 掉线自愈（秒数 ____）：通过|失败
F6 断网恢复：通过|失败|未做
F7 全屏抽查：通过|问题
5 B3 闭环：通过（orderId ____）|未做
说明：未造未支付单；未用紧急吊销；未贴任何 token / 绑定码
```

## 7. 边界声明

- 本单只证明「新契约下 Kiosk 与 Agent 能建立会话并出纸」。以下仍是**未验收**，通过本单也不得改口：双面长边/短边实际翻页方向、本地驱动控制彩色、卡纸 / 缺纸 / 缺粉恢复、扫描仪进件、身份证复印、U 盘导入、Windows Assigned Access 专用会话。
- 打印参数继续只开放 `black_white + simplex + pagesPerSheet=1`。
- 安装包未经企业 Authenticode 签名，本单不构成正式发布或批量部署授权。
- 回执收到后，只勾 checklist §五中**已举证**的子项；F3 没出纸则 §5.6 保持打开。

## 8. 实际执行回执（2026-09-06）

```text
WINDOWS AGENT 升级 + Phase F 复验回执（2026-09）
安装包：5bff1bc42 / run 34026906605 / candidate-identity.json 已核对 = 是
A1 安装方式：EXE/MSI；安装目录 C:\\Program Files\\AIJobPrintAgent
A6 8/31 后断心跳原因：旧 Agent 服务于 2026-08-31 23:42:54 停止，之后未运行
2 升级路径：2B（EXE/MSI）+ 重新绑定；绑定：成功；恢复运行：是
2C boot-ticket 接口：200 + 60s = 是；printer-status isOnline=true：是；printerStatus=ready
3 看门狗：任务已注册 = 是；watchdog.log bootTicket=True = 是
F1 服务 Running/Automatic：是；printerName 一致：是（Pantum CM2800ADN Series）
F2 Kiosk 会话就绪：通过（启动票兑换后地址栏不含 boot_ticket）
F3 真机出纸：通过（taskId ptask_kiosk_73db2dfb9b9546e0；现场确认 1 页已出纸；队列回空）
F4 停用即拒 + 启用后恢复：未做
F5 Agent 掉线自愈：未做
F6 断网恢复：未做
F7 全屏抽查：未做
5 B3 闭环：未做
说明：未造未支付单；未用紧急吊销；未贴任何 token / 绑定码
```

补充证据：生产 Kiosk 首次不带启动票的测试提交被安全门禁拒绝；随后通过本机 Agent 新取启动票进入 Kiosk，完成上传、材料检查、黑白单面 1 页免费打印。Agent 日志记录领取、文件哈希校验、打印成功、`completed` 回传和临时文件删除；现场确认纸张已从奔图出纸口出来。首次提交页显示订单号 `ORD-20260906-9D3B5DA26F`，完成页显示另一内部订单标识，需后续核对订单号展示口径。

风险记录：Agent 日志在 13:02–13:06 UTC（北京时间 21:02–21:06）多次出现 `task-runner: claim cycle error — HTTP 429 [RATE_LIMITED]`，13:06:22 UTC 才成功领取本次任务；期间心跳仍被确认，最终任务正常完成。该现象未导致本次打印失败，但上线前需核对云端 claim 限流窗口、Agent 领取间隔和多终端高峰行为，不能把本次最终完成当作限流问题已解决。

## 9. 第二轮回执（2026-09-07）

执行分支：`field/windows-429-and-phase-f-2026-09-07`，基于 `origin/main@f0aa458e5c27220b089b1cf9941c4b4e3d79a156`。本轮未改 `services/**`、`apps/kiosk/**`、`apps/admin/**`、`apps/miniapp/**`、`.github/**`；未记录或输出 token、绑定码、桥接令牌。

### 第 1 件：止血

- 时间：2026-09-07 12:06–12:10（北京时间）。只读配置确认 `terminalId=t_ksk_001`、`terminalCode=KSK-001`、`printerName=Pantum CM2800ADN Series`、`apiBaseUrl=https://zyidai.cn/api/v1`、原 `claimIntervalMs=1000`。
- 已安装脚本两次执行均在原子提交阶段失败：`Local API allowed origin cannot be empty`（未传 Origin 的首次尝试），以及 `Could not commit production config and terminal token locally`（显式传回原有 Origin 后仍失败）。配置未被半写入。
- 为完成本机止血，停服后仅修改结构化 `agent-config.json` 的 `claimIntervalMs` 为 `5000`，保留其他非密字段和 DPAPI 文件，随后启动服务。
- 验收：配置 `claimIntervalMs=5000`；日志 `[2026-09-07T04:06:53.760Z] INFO task-runner: starting — interval=5000ms`；服务 `Running/Automatic`；boot ticket `success=true, expiresInSeconds=60`。止血后观察窗口内无新的旧式 `HTTP 429 [RATE_LIMITED]`。

### 第 2 件：安装新 Agent

- 时间：2026-09-07 12:18–12:30。GitHub Actions run `34079704036` 产物下载命令因 GitHub CLI 长时间无输出中止，随后用同一 run 的 artifact `terminal-agent-unsigned-installer-candidates`（artifact id `10003476659`）下载并解压。
- `candidate-identity.json`：`sourceCommit=f0aa458e5c27220b089b1cf9941c4b4e3d79a156`，`productVersion=0.4.11`；安装器 SHA-256 与 identity 一致。
- EXE Burn 界面进程无可控窗口且停在半升级状态，已结束安装器进程；随后同一候选 MSI 静默同机升级返回 `0`。安装目录运行 `dist/index.js` 与 MSI 解包后的候选文件 SHA-256 相同，证明 payload 已更新。配置、SQLite 与凭证保持原位，无重新绑定。
- 验收：`aijobprintagent.exe` `Running/Automatic`；`POST http://127.0.0.1:9527/local/terminal-boot-ticket` 返回 `success=true`、`expiresInSeconds=60`；日志 `task-runner: starting — interval=5000ms`。安装器未保留 Automatic，已手动恢复并记录为安装器行为。

### 第 3 件：真机 429 退避

- 时间：2026-09-07 12:32–12:41。临时将配置设为 `1000ms`，对真实 API 运行约 8 分钟后恢复 `5000ms`。
- 脱敏日志：

```text
[2026-09-07T04:32:37.315Z] WARN task-runner: configured claim interval 1000ms is below the server rate-limit budget
[2026-09-07T04:32:37.315Z] INFO task-runner: starting — interval=1000ms
[2026-09-07T04:33:03.706Z] WARN task-runner: claim rate limited (HTTP 429) — pausing claims for 60.2s
[2026-09-07T04:34:34.530Z] WARN task-runner: claim rate limited (HTTP 429) — pausing claims for 60.5s
[2026-09-07T04:36:06.384Z] WARN task-runner: claim rate limited (HTTP 429) — pausing claims for 60.2s
[2026-09-07T04:37:37.223Z] WARN task-runner: claim rate limited (HTTP 429) — pausing claims for 60.7s
[2026-09-07T04:39:09.049Z] WARN task-runner: claim rate limited (HTTP 429) — pausing claims for 60.5s
[2026-09-07T04:40:40.867Z] WARN task-runner: claim rate limited (HTTP 429) — pausing claims for 60.9s
[2026-09-07T04:41:04.967Z] INFO task-runner: starting — interval=5000ms
```

- 429 暂停期间没有每秒刷 429；未出现 `claim unauthorized`，未观察到任务被标 `failed`。最终配置和服务恢复为 `5000ms` / `Running/Automatic`。

### 第 4 件：Phase F 与延迟溯源

- F4 停用即拒：**未验收**。管理员设备页现场返回 `共 0 台终端`，无法安全选择 `KSK-001` 做停用/恢复；需要 Mac 侧处理线上设备列表/API 数据问题。未点「紧急吊销凭证」。
- F5 Agent 掉线自愈：**未验收/失败**。完整复验记录了 `boot ticket unavailable after automatic retry window; launching without ticket` 与 `bootTicket=False`；恢复服务后心跳恢复，但观察 75 秒未出现执行单预期的自动重启日志 `local Agent is reachable again; restarting ticketless kiosk browser with a boot ticket`。随后手动关闭无票浏览器，12 秒内看门狗重新启动 `bootTicket=True`。需要 Mac 侧处理看门狗恢复触发逻辑或安装目录版本差异。
- F6 断网恢复：通过。2026-09-07 12:43:47–12:45:56 禁用 WLAN/以太网约 70 秒后恢复；断网期间日志为 `getaddrinfo ENOTFOUND zyidai.cn` 与 2/4/6 秒重试，恢复后 `[2026-09-07T04:45:15.947Z] INFO heartbeat: ✓ acknowledged`，未重启服务。
- F7 全屏抽查：通过。看门狗 `Running`，动作指向 `C:\Program Files\AIJobPrintAgent\kiosk\kiosk-watchdog.ps1`；Kiosk Edge 以 `--kiosk`、`--edge-kiosk-type=fullscreen`、`--aijobprint-kiosk=1` 运行并带启动票。
- 连续多订单矩阵（顺序组/突发组）：**未验收**。本轮未造订单、未造未支付单；后台设备列表为 0，无法安全建立矩阵任务。
- 2026-09-06 延迟溯源：第一条 429 为 `[2026-09-06T13:02:21.264Z]`，领取成功为 `[2026-09-06T13:06:22.766Z] INFO task-runner: claimed task ptask_kiosk_73db2dfb9b9546e0`，间隔约 241.5 秒。期间心跳仍为 acknowledged；13:02–13:06 UTC 共记录 182 条 `task-runner` 行，且为约 1 秒一次的旧 Agent 重试序列。随后 13:06:25.042Z 打印成功、13:06:29.416Z completed。该证据表明旧 Agent 未按 Retry-After 退避，4 分钟来自持续 429 重试叠加服务端窗口，仍需 Mac 侧结合服务端限流日志确认是否有第二个窗口。

交付说明：本轮没有新增功能入口或外部依赖；未做 B3 闭环、未做连续打印矩阵；上述未验项保持未验收。
