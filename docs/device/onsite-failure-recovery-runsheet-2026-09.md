# 故障恢复现场验收脚本（2026-09）

> 版本：`origin/main@cbe9d4445221`（2026-09-10 检出）· 执行人：____ · 核对人：____ · 日期：____
> 终端：____（`terminalCode` / `terminalId`）· 打印机 Windows 识别名（现场 `Get-Printer`，须等于 Agent `printerName`）：____
> 本单只验收**人为制造后的故障恢复**。顺利出纸不在范围内。
>
> 对应真空：`docs/delivery/kiosk-redesign-r1/evidence/EV-013-device-color-duplex.txt` 写明「故障恢复路径（缺纸 / 卡纸 / 断网重连 / 缺粉）未验证。按 domain-overlays 的要求，物理设备 GO 必须包含故障恢复记录，仅证明顺利路径不足」。顺利路径脚本 `docs/device/onsite-acceptance-runsheet-2026-09.md`（若尚未合入，以现场持有的那份为准）也声明不覆盖本段。
>
> **禁止把本单任何一格的「与代码一致」写成整机商用 GO。** 物理设备不接受截图或状态徽章作为 GO 证据。

---

## 0. 本文怎么用

每个场景四段，缺一段就不算写过、现场不得画勾：

1. **怎么人为制造**（现场能做的具体动作）
2. **系统应该怎么反应**（从当前代码读出，标 `依据：文件:行号`）
3. **用户在屏幕上应该看到什么**（文案必须能在仓库 grep 到；grep 不到写「此处应有提示（当前实现未见）」，**不得编一句**）
4. **恢复后状态 + 钱和纸的对账**（谁欠谁）

覆盖场景：F1 缺纸 · F2 卡纸 · F3 缺粉/墨量低 · F4 打印机断电或拔 USB · F5 拔网线后恢复 · F6 Agent 被杀后恢复 · F7 支付成功但出纸失败。

| 场景 | 软件侧有没有对应该故障的自动处置 | 计入文末「无自动处置」 |
|------|----------------------------------|------------------------|
| F1 缺纸 | 有 `PAPER_EMPTY` 路径，但本机型驱动已知不置缺纸位；兜底是 `PRINT_JOB_UNCONFIRMED`。**没有**补纸后续打同一任务。 | 否（有 fail-closed 兜底） |
| F2 卡纸 | 队列 `Jammed` → `PRINTER_ERROR`；驱动不置位则同样落入未确认。清卡纸是人工。 | 否 |
| F3 缺粉 / 墨量低 | 低墨明确不阻塞、耗材不上报、一体机禁止「墨粉不足」 | **是** |
| F4 断电 / 拔 USB | `WorkOffline` → `PRINTER_OFFLINE`；生产拦新单 | 否 |
| F5 拔网线 | Agent 离线队列重试 PATCH；心跳超时后拦新单 | 否 |
| F6 杀掉 Agent | WinSW 崩溃重启 + 本地库对账，不自动重印 | 否 |
| F7 已付款未出纸 | 打印任务会 fail-closed；**退款不会自动出款** | **是（资金侧）** |

---

## 1. 动手前必读：这台奔图的已知限制

现场若按「缺纸就该立刻出缺纸文案」去对照，会把**驱动不报**误判成**系统坏了**。先把这几条当前提，不要当故障。

1. **缺纸预检在本机型不可用。** `Win32_Printer.DetectedErrorState=4`（No Paper）才会预检成 `paper_empty`；注释写明 Pantum CM2800ADN 驱动 **不经 WMI 置这个位**（`apps/terminal-agent/src/agent/wmi.ts:25-26,178-179`）。
2. **心跳枚举里没有 `paper_empty`。** Agent 上报类型是 `'ready' | 'offline' | 'error' | 'low_paper' | 'unknown'`（`apps/terminal-agent/src/agent/types.ts:126`）。WMI `DetectedErrorState=4/6/7/8` 在心跳里一律映射成 `'error'`，不是 `'paper_empty'`（`wmi.ts:124-125`）。服务端 `UNAVAILABLE_PRINTER_STATUSES` 虽然含 `'paper_empty'`（`services/api/src/terminals/printer-availability.ts:24`），本机型心跳几乎送不出这个值。
3. **打印中途缺纸，本机型不报 `PaperOut`。** 队列监控只有连续两次 `PaperOut` 才报 `PAPER_EMPTY`（`task-runner.ts:512-513,691-703`）。解析器注明 Pantum **不会**走这条（`wmi.ts:247`）。本机型常见的是 `Printing, Retained`，成功出纸和等纸**无法用 Get-PrintJob 区分**（`wmi.ts:410-415`，`task-runner.ts:719-722,783-793`）。
4. **队列「完成」只证明 Windows 后台打印生命周期，不证明纸到了用户手里**（`wmi.ts:352-353,418-419`，`task-runner.ts:636-637,732-734`）。
5. **低墨与低纸在心跳里是同一个值。** `DetectedErrorState=3`（Low Paper）和 `=5`（Low Toner）都映射成 `'low_paper'`（`wmi.ts:32,127`）。预检把低纸/低墨都当成可打印（`wmi.ts:174,213-214`）。
6. **Agent 不上报耗材百分比。** 一体机 `tonerKnown=false`，禁止用假数值触发「墨粉不足」（`apps/kiosk/src/hooks/useTerminalDeviceStatus.ts:10,33-34,94-95`）。

时间窗（现场对表用，不要用后台说明里的「3 分钟」去卡）：

| 窗口 | 取值 | 依据 |
|------|------|------|
| Agent 心跳 | 默认 30 秒 | `apps/terminal-agent/src/agent/heartbeat.ts:215` |
| 终端在线 / 拦新单 | 最近心跳超过 **5 分钟**视为离线 | `printer-availability.ts:8-9,19-20` |
| 出纸监控 | 30s + 每面 3s，封顶 5 分钟 | `task-runner.ts:128-137,517` |
| claim 租约 | 5 分钟 | `terminals-agent.service.ts:408` |
| 服务端 `printing` 超时 | 10 分钟 → `PRINT_JOB_UNCONFIRMED`，禁止自动重派 | `terminals-agent.service.ts:780-805` |
| 一体机进度轮询 | 每 3 秒；连续 5 次读失败才判失败；客户端 10 分钟查不到终态走「查询超时」 | `PrintProgressPage.tsx:124-126,331-332,452-501` |
| 一体机设备状态刷新 | 60 秒 | `useTerminalDeviceStatus.ts:54` |
| 离线 PATCH 重试 | 每 60 秒，指数退避，最多 10 次 | `offline-queue.ts:35-38` |
| Agent 崩溃重启 | 第一次 60 秒后重启，第二次 300 秒，第三次不再自动拉起 | `apps/terminal-agent/installer/bootstrap/aijobprintagent.xml:9-11` |

管理员告警页写的是「终端离线（心跳超 3 分钟）」（`apps/admin/src/routes/alerts/index.tsx:153`）。**以代码 5 分钟为准**；现场不要用那句 3 分钟去判定系统对不对。

---

## 2. 前置、授权、取证

### 2.1 授权与安全

- [ ] 已取得现场执行授权（本机 Windows + 奔图）。人为缺纸 / 卡纸 / 拔电有损坏设备风险，卡纸**不要让用户或验收人自己拽纸**。
- [ ] 只用可丢弃测试账号与**小额已付单**。F7 必须 `amountCents > 0`；现场若是 0 元免费单，F7 资金对账记「未执行（免费单无资金）」，不得画勾。
- [ ] 不把 Agent token、桥接 token、支付密钥写入本单或聊天。
- [ ] 每条场景开始前：纸盒有纸、粉盒在位、USB 已接、Agent `Running` / `Automatic`、无卡住的 `claimed`/`printing` 任务。上一条未恢复，不准开下一条。

### 2.2 每条场景固定要记的证据

不要只拍屏幕。至少：

1. 订单号 / 任务号 / 时间（精确到秒）
2. 一体机屏幕**逐字**文案（可与下文白名单对照；对不上就记「与仓库不一致」而不是改口）
3. Agent 日志（`%ProgramData%\AIJobPrintAgent\logs`）里的 `errorCode`
4. 下面这条 WMI / 队列快照（故障中、恢复后各一次）
5. 出纸口实拍：出了几张、空白/缺页/卡纸残页
6. Admin：该任务 `errorCode`、`printOutcome`、订单 `payStatus`、是否 `refundRequired`

```powershell
# 打印机名换成现场 Agent printerName，禁止写死其它型号
$p = '<printerName>'
Get-CimInstance Win32_Printer -Filter "Name='$p'" |
  Select-Object Name, PrinterStatus, DetectedErrorState, WorkOffline
Get-PrintJob -PrinterName $p -ErrorAction SilentlyContinue |
  Format-List DocumentName, JobStatus
Get-Service | Where-Object { $_.Name -match 'AIJob|aijobprintagent' } |
  Format-List Name, Status, StartType
# 本机 Agent 面板（仅 127.0.0.1）
# 浏览器打开 http://127.0.0.1:9527/local/panel
```

`PrinterStatus` 对照（`wmi.ts:13-20`）：`3=Idle`，`7=Offline`；断电时常是 `WorkOffline=True` 而 `PrinterStatus` 仍为 3。

---

## F1 缺纸（打印中途抽走纸）

### ① 怎么人为制造

1. 纸盒留大约 5–10 张，够开始出纸、不够打完。用 **≥2 页**测试 PDF（1 页可能在抽纸前打完）。
2. 走完整建单。**推荐免费单**（F1 不测资金；资金走 F7）。
3. 进度页出现「正在打印」/「打印机正在出纸」后，**打开纸盒抽走剩余纸**，盒盖按现场习惯关好。
4. 不要立刻补纸。先等到一体机进入结果页，或出纸监控窗口结束（见 §1，最多约 5 分钟）。
5. 记录 Get-PrintJob 的 `JobStatus` 原文，以及是否出现 `PaperOut`。

对照实验（可选，另开一单）：抽纸后在监控窗口内**立刻补纸**，看任务是 `completed` 还是仍失败。

### ② 系统应该怎么反应

依据：

- 预检只在 WMI 明确 `DetectedErrorState=4` 时拦截，给出 `PAPER_EMPTY`（`task-runner.ts:163-164,412-429`）。本机型驱动已知不置该位（`wmi.ts:25-26,178-179`）→ **打印前预检通常放行**。
- 派发成功后监控队列：`PaperOut` 须连续两次才失败（`task-runner.ts:691-703`）。本机型注释写明不报 `PaperOut`（`wmi.ts:247`）。
- 本机型常见 `Printing, Retained`：监控若等到 PrintService 事件 307 则报完成（`task-runner.ts:727-729`）；否则超时 fail-closed 为 `PRINT_JOB_UNCONFIRMED`（`task-runner.ts:783-793,804-811`）。**不会自动重印**。
- 心跳在缺纸时若仍是 `ready`（本机型很可能），生产拦新单（PRT-03）**不会**因缺纸挡住下一单（`printer-availability.ts:22-24,48-49`）。不要指望「没纸了就收不到钱」。

可能落到的 `errorCode`（按实际日志勾，不要按愿望勾）：

| 实际信号 | 上报 | 依据 |
|----------|------|------|
| 连续两次 `PaperOut` | `PAPER_EMPTY` | `task-runner.ts:696-702` |
| `Retained` 等到 307 | `completed`（只证明队列，不证明纸到手） | `task-runner.ts:727-729,636-637` |
| `Retained` 超时 / 从未看清作业 | `PRINT_JOB_UNCONFIRMED` | `task-runner.ts:783-811` |
| 作业消失在曾经的缺纸信号之后 | `PRINT_JOB_UNCONFIRMED` | `task-runner.ts:748-751` |

### ③ 用户在屏幕上应该看到什么

**打印中（尚未终态）**，进度页已有的说明（不是结果页）：

- 「如遇卡纸或缺纸，请联系现场工作人员」（`PrintProgressPage.tsx:159,171`）
- 「打印机缺纸 / 卡纸：任务会提示失败原因，请联系现场工作人员处理后重试。」（`PrintProgressPage.tsx:786`）

**终态按 `errorCode` 分叉**（结果页以服务端 `failureReasonForUser` 为准，`print-jobs.service.ts:115-129,605-614`；Agent 原始 `errorMessage` 不透出）：

若实际是 `PAPER_EMPTY`（本机型**少见**，但代码有这条）：

| 位置 | 文案 | 出处 |
|------|------|------|
| 服务端给用户的失败原因 | `打印机缺纸，请联系工作人员补纸` | `print-jobs.service.ts:119` |
| 进度页本地码表（仅当接口没带回 `failureReasonForUser`） | `打印机缺纸，当前无法打印，请联系工作人员补纸后重试` | `PrintProgressPage.tsx:111` |
| 完成页标题 | `打印机缺纸` | `PrintDonePage.tsx:477,502` |
| 完成页叙述 | `机器里没纸了。` / `不是你操作的问题，纸匣空了，加纸后可以继续。` / `纸匣已空，剩下没打的部分会在加纸后继续。已出的纸你可以先拿走。加纸后继续打印不需要重新下单。` | `PrintDonePage.tsx:483-491,573` |
| 确认页（下一单，且心跳被认成缺纸） | `打印机缺纸，当前不能下单，不会扣费。请联系工作人员补纸后再试。` | `PrintConfirmPage.tsx:128-129` |
| 预览页 | `打印机缺纸，请联系工作人员补纸` | `PrintPreviewPage.tsx:287` |
| 顶栏/首页徽章 | `打印机缺纸` | `useTerminalDeviceStatus.ts:122` |

若实际是 `PRINT_JOB_UNCONFIRMED`（本机型**更常见**）：

| 位置 | 文案 | 出处 |
|------|------|------|
| 服务端给用户 | `打印作业未确认完成，请工作人员检查出纸状态` | `print-jobs.service.ts:121` |
| 进度页本地码表 | `打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态` | `PrintProgressPage.tsx:113` |
| 完成页标题 | `打印结果未确认` | `PrintDonePage.tsx:473,502` |
| 完成页叙述 | `这次打印结果未确认。` / `系统已经正式登记，工作人员核查后给出结论，不会让你自认倒霉。` / `设备在断电、失联或硬件异常后，无法确认这次打印的实际结果。…` | `PrintDonePage.tsx:479-487,568-569` |
| 完成页主按钮 | `联系工作人员核查` | `PrintDonePage.tsx:525` |
| 屏幕上会出现的内部码展示 | `errorCode = PRINT_JOB_UNCONFIRMED` | `PrintDonePage.tsx:577` |

**不要根据完成页「加纸后继续打印不需要重新下单」去操作。** 那句话在仓库里，但服务端会把任务写成 `failed`，没有「补纸后同一任务接着打」的实现（见 ④）。现场以任务终态和是否出现「重新提交打印」按钮为准。

专用「缺纸传感器已触发、请补纸」的实时横幅：此处应有提示（当前实现未见）。本机型心跳几乎不上报 `paper_empty`，顶栏在缺纸中途仍可能显示 `打印机在线`（`useTerminalDeviceStatus.ts:90-97`）。

### ④ 恢复后状态，以及钱和纸

人工：把纸放回纸盒，清掉打印机面板/队列里的残留作业（现场按奔图面板操作，本仓库没有自动清队列）。

| 终态 | 同一任务会不会接着打 | 钱 | 纸 |
|------|----------------------|----|----|
| `PAPER_EMPTY` + 已付 | 不会自动续打。已付失败且**不是** `PRINT_JOB_UNCONFIRMED` 时，完成页可出现「重新提交打印」（`PrintDonePage.tsx:513-522`；服务端 `retryPaidFailedJob`，`print-jobs.service.ts:667-701,805-816`），**不再计费**。不点按钮就只停在 failed。 | 用户已付、纸未打完 → **平台欠用户履约或退款**，不会自动退。 | 已出的页归用户；未出的页未履约。 |
| `PRINT_JOB_UNCONFIRMED` + 已付 | **禁止**重新提交（`print-jobs.service.ts:694-700`）。须人工看出口，走 F7 核查。 | 在核查前两边都可能欠：纸可能已出。 | 以出口实物为准，不以屏幕为准。 |
| `completed` 但出口张数不够 | 系统认为打完。 | 用户已付且系统记完成 → **若纸不够，平台欠纸；系统不会自己发现**。 | 记实出张数。这是本机型 Retained/307 的已知盲区。 |
| 免费单 | 无资金。 | 无。 | 同上，只对纸。 |

补纸后**不会**把已 `failed` 的任务自动改回 `pending`。新的用户来打，只要心跳仍是 `ready`，生产仍可能收下一单（§1.2）。

- [ ] 实际 `errorCode`：________
- [ ] 出口实出 ____ 张 / 应付 ____ 张
- [ ] 与 §1 驱动限制是否一致（是/否）
- [ ] 本条通过不得写成「缺纸检测已验收通过」，除非日志里真有 `PAPER_EMPTY`

---

## F2 卡纸

### ① 怎么人为制造

1. 纸盒有纸。用 ≥2 页测试 PDF，建单后开始打印。
2. 出纸过程中制造卡纸（夹一张皱纸，或按奔图面板支持的方式停纸）。**禁止伸手进热定影区拽纸。**
3. 卡住后不要清。先等到一体机结果页或监控窗口结束。
4. 记录 `Get-PrintJob` 的 `JobStatus` 是否含 `Jammed` / `Error` / `UserIntervention`。
5. 再由**会操作这台机器的人**按奔图说明书清卡纸，打一张测试页确认机械恢复。

### ② 系统应该怎么反应

- 预检：`DetectedErrorState=8`（Jammed）→ `'error'` → `PRINTER_ERROR`（`wmi.ts:180,212`，`task-runner.ts:165-166`）。打印**开始后**才卡纸，预检已经过了。
- 监控：`JobStatus` 含 `jammed` / `error` / `userintervention` / `deleting` / `deleted` / `cancelled` → 立即 `PRINTER_ERROR`（`wmi.ts:395-406`，`task-runner.ts:706-716`）。`jammed` 时 Agent 内部消息带「可能卡纸」（`task-runner.ts:708-713`）；用户端仍只看到白名单（`print-jobs.service.ts:120`）。
- 驱动不置这些位：与 F1 相同，落入 `PRINT_JOB_UNCONFIRMED`，不自动重印。
- 心跳若报到 `'error'`：生产拦新单（`printer-availability.ts:24,48-49,66-68`）；一体机确认页不能下单。

仓库里**没有**「自动退纸 / 自动清卡纸 / 只补打剩余页」的实现。

### ③ 用户在屏幕上应该看到什么

打印中：与 F1 相同的「如遇卡纸或缺纸，请联系现场工作人员」（`PrintProgressPage.tsx:159,171,786`）。

若实际是 `PRINTER_ERROR`：

| 位置 | 文案 | 出处 |
|------|------|------|
| 服务端给用户 | `打印机可能卡纸或发生设备故障，请联系工作人员处理` | `print-jobs.service.ts:120` |
| 进度页本地码表 | `打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理` | `PrintProgressPage.tsx:112` |
| 完成页标题 | `打印机卡纸` | `PrintDonePage.tsx:475,502` |
| 完成页叙述 | `纸卡住了，别硬拉。` / `硬拉可能撕坏纸、伤到机器，交给我们来处理。` / `请不要自己打开机器或拽纸。工作人员会取出卡纸并补打受影响的部分，已出的纸你先收好。` | `PrintDonePage.tsx:481-489,571` |
| 预览页 `hardwareError` | `打印机异常，请联系工作人员检查后再打印` | `PrintPreviewPage.tsx:284-285` |
| 顶栏 | `打印机异常` | `useTerminalDeviceStatus.ts:135` |

注意：完成页把**所有** `PRINTER_ERROR` 都画成卡纸（`PrintDonePage.tsx:118`）。缺粉打空、开盖、其它驱动 Error 也会走这套卡纸画面。现场不要一看到「卡纸」就认定一定是卡纸，以出口和打印机面板为准。

预览页另有一句 `打印机卡纸，请联系工作人员处理后再打印`（`PrintPreviewPage.tsx:282-283`），但它判的是 `printer.errorCode === 'paperJam'`；`useTerminalDeviceStatus` 的 `'error'` 分支写的是 `hardwareError`（`:133`），**心跳异常时这句卡纸预览通常不会出现**。

若实际是 `PRINT_JOB_UNCONFIRMED`：文案同 F1 未确认分支。

### ④ 恢复后状态，以及钱和纸

人工清卡纸。系统不会在清完后自动续打同一任务。

| 终态 | 同一任务 | 钱 | 纸 |
|------|----------|----|----|
| `PRINTER_ERROR` + 已付 | 可「重新提交打印」（整单重排，不是「只补剩下的页」）。 | 已付未履约完 → **平台欠履约或退款**；重提不再收费。 | 卡住的残页作废；已出完好的页归用户。完成页「补打受影响的部分」是给工作人员的口头指引，**不是**系统自动拆页。 |
| `PRINT_JOB_UNCONFIRMED` + 已付 | 禁止重提，走 F7 核查。 | 核查前不要退、也不要重打。 | 以出口为准。 |
| 免费单 | 无资金。 | 无。 | 同上。 |

- [ ] 实际 `errorCode`：________
- [ ] 卡纸已由有资格的人清除、测试页正常：____
- [ ] 本条通过不得写成「卡纸自动恢复已验收」

---

## F3 缺粉 / 墨量低

**当前无自动处置，需人工介入。**

### ① 怎么人为制造

按风险从低到高，能做哪档做哪档，并记下 WMI：

1. **墨量低（优先）**：用即将耗尽的粉盒，或厂家面板能显示的低墨状态。不要为验收故意倒空整支新粉。
2. **粉盒不在位**：打开前盖，取下黑色粉盒，保持开盖或按现场能复原的方式取下。这可能被驱动报成开盖（`DetectedErrorState=7`）而不是 No Toner（`=6`）。
3. 制造前后都跑 §2.2 的 WMI 快照，记下 `DetectedErrorState` 原值。
4. 尝试进入 `/print/confirm`：看能不能下单。不要在粉盒未装好时强行打很多页。

### ② 系统应该怎么反应

- **低墨（DetectedErrorState=5）**：心跳 `'low_paper'`（`wmi.ts:32,127`）；预检 `'ok'`，**不拦截打印**（`wmi.ts:174,213-214`）。生产拦新单名单不含 `'low_paper'`（`printer-availability.ts:24`）。一体机 `printerReady=true`（`useTerminalDeviceStatus.ts:99-110`）。
- **无粉（DetectedErrorState=6）**：心跳 `'error'`，预检 `'error'` → `PRINTER_ERROR`（`wmi.ts:124-125,180,212`，`task-runner.ts:165-166`）。与卡纸、开盖同一条错误码。
- **耗材数值**：心跳 payload 无 toner 百分比；一体机强制 `tonerKnown=false`（`useTerminalDeviceStatus.ts:10,270`）。
- 仓库里没有「墨量低于阈值暂停接单 / 自动退款 / 缺粉专用 errorCode」。

本机型驱动若也不置 `=5/=6`，WMI 会一直是 `DetectedErrorState=0`，系统会当正常 Idle（`wmi.ts:128-142`）。那种情况下连 `PRINTER_ERROR` 都不会来。

### ③ 用户在屏幕上应该看到什么

**缺粉 / 墨粉不足 / 请更换粉盒：此处应有提示（当前实现未见）。** 代码反而禁止编造墨量（`useTerminalDeviceStatus.ts:10`）。

低墨被映射成 `'low_paper'` 之后，屏幕上会出现的是**纸**的说法，不是粉：

| 位置 | 文案 | 出处 |
|------|------|------|
| 预览页（`printerKind === 'low_paper'`） | `纸量偏低，建议补纸后再大批量打印` | `PrintPreviewPage.tsx:289` |
| 顶栏 / 首页打印磁贴 | 仍是 `打印机在线`（低纸/低墨不改徽章） | `useTerminalDeviceStatus.ts:109`；首页磁贴 `QxHomeView.tsx:181` |
| Agent 本机面板 | `打印纸不足` | `status-panel.ts:18` |

无粉若报到 `PRINTER_ERROR`，一体机完成页会按 F2 显示「打印机卡纸」。这是现有映射，不是缺粉文案。

反馈词表有 `设备缺纸`（`kioskFeedback.ts:64`），**没有**缺粉选项。完成页反馈是「页数与预期不符 / 打印发黑 / 发花 / 卡住没出完 / 其他打印问题」（`kioskFeedback.ts:57-60`）。发黑/发花可作质量反馈，不是系统识别缺粉。

### ④ 恢复后状态，以及钱和纸

人工：装回粉盒、关盖，打一张测试页，看颜色是否恢复。系统不会在换粉后自动重跑失败任务。

| 实际 WMI | 下单 | 钱 | 纸 |
|----------|------|----|----|
| `DetectedErrorState=5`（低墨） | 照常收。可能打出浅色/缺色页且任务 `completed`。 | 已付且系统记完成 → **质量问题需人工判**；无自动退。 | 浅色页仍算出纸。 |
| `DetectedErrorState=6` 或开盖 `=7` | 预检失败则 `PRINTER_ERROR`，已付可重提或走人工退款。 | 未出纸则平台欠履约/退款。 | 0 张或残页。 |
| 驱动不置位 | 系统当正常。 | 同低墨。 | 以实物为准。 |

- [ ] `DetectedErrorState` 故障中：____ 恢复后：____
- [ ] 一体机是否出现任何「粉 / 墨 / 硒鼓」字样（预期：否）：____
- [ ] 本条结论只能写「缺粉无自动处置，已用人工换粉恢复」，不能写「缺粉检测已验收」

---

## F4 打印机断电 / 拔 USB

### ① 怎么人为制造

两条都要尽量做（信号不同）。每次只做一件，做完恢复再做另一件。

**A. 断电**：打印空闲时关掉奔图电源，等 10 秒。跑 WMI：预期 `WorkOffline=True`（`wmi.ts:16-20,207-209`）。再开一次**打印中断电**（进度页已到「正在打印」后关电源）。

**B. 拔 USB**：确认现场端口是 USB（常见 `USB001`，以 `Get-Printer` 的 `PortName` 为准）。空闲时拔掉 USB 线；可选再做一次打印中拔线。

不要同时拔网线（那是 F5）。打印机电源/USB 与主机上网不是同一根线。

### ② 系统应该怎么反应

- 预检：`WorkOffline=True` 或 `PrinterStatus=7` 或 `DetectedErrorState=9` → `PRINTER_OFFLINE`（`wmi.ts:207-210`，`task-runner.ts:161-162`）。
- 心跳：同上映射为 `'offline'`（`wmi.ts:122-123`）。
- 生产 `PRINT_REQUIRE_PRINTER_ONLINE=true` 时，离线/故障心跳拒绝建单，用户可见 `本机打印机当前不可用（离线、缺纸或故障），暂不能下单，请联系工作人员` 或无心跳时的 `本机打印服务暂未就绪，暂不能下单，请稍后再试或联系工作人员`（`printer-availability.ts:58-72`）。一体机白名单同义句：`打印机当前不可用（离线、缺纸或故障），请稍后再试或联系现场工作人员`（`userErrorMessage.ts:69`）。
- 打印**已经**派进队列后断电：Sumatra 可能已退出；监控看不到完成则 `PRINT_JOB_UNCONFIRMED`（`task-runner.ts:804-811`）。不自动重印。
- Agent 进程应仍在。本条不是杀 Agent（F6）。

### ③ 用户在屏幕上应该看到什么

空闲 / 下一单：

| 位置 | 文案 | 出处 |
|------|------|------|
| 顶栏 / 首页徽章 | `打印机离线` | `useTerminalDeviceStatus.ts:83,143` |
| 确认页 | `{打印机离线}。当前不能下单，不会扣费。请联系工作人员检查设备后再试。` | `PrintConfirmPage.tsx:130-131` |
| 预览页 | `打印机离线，请联系工作人员` | `PrintPreviewPage.tsx:281` |
| 服务端给已失败任务 | `打印机离线，请联系工作人员检查设备` | `print-jobs.service.ts:118` |
| 进度页本地码表 | `打印机离线，请联系工作人员检查电源 / 网线 / USB 后重试` | `PrintProgressPage.tsx:110` |
| Agent 本机面板 | `打印机离线` | `status-panel.ts:16` |

打印中途断电且落到未确认：完成页走 F1 的 `PRINT_JOB_UNCONFIRMED` 文案，标题是「打印结果未确认」不是「打印机离线」。

首页打印磁贴离线时徽章用 `device.printerLabel`（`QxHomeView.tsx:181`），即「打印机离线」，不会写「设备正常」。

### ④ 恢复后状态，以及钱和纸

人工：插回 USB、开电源，等打印机 Idle。WMI `WorkOffline=False`。心跳最多约 30 秒刷新；一体机状态最多约 60 秒刷新。确认页应重新允许下单。

| 时机 | 任务 | 钱 | 纸 |
|------|------|----|----|
| 付款前断电 | 建单被拒，不收款。 | 无。 | 无。 |
| 已付、claim 前/预检失败 `PRINTER_OFFLINE` | 任务 `failed`，可重提（非 UNCONFIRMED）。 | 平台欠履约或退款。 | 0。 |
| 已付、已派发后断电 → UNCONFIRMED | 禁止重提，走 F7。 | 核查前不要退。 | 可能已出部分。 |

Windows 可能把未完成作业留在队列。恢复后若队列自己续打，**可能未经过 Agent 再报一次 completed**。现场恢复后先看 `Get-PrintJob` 是否还有残留，再决定要不要手动取消。

- [ ] A 断电空闲：心跳 `offline`、确认页拒单：____
- [ ] A 断电打印中：`errorCode`：________
- [ ] B 拔 USB：同上：____
- [ ] 恢复后可建一单免费测试（本条不要求再付一次）

---

## F5 网络中断（拔网线）后恢复

### ① 怎么人为制造

拔的是**一体机主机上互联网的那根网线**（或禁用那块网卡），不是打印机 USB。本机打印机走 USB 时，断网后本地仍可能出纸。

建议两单：

1. **空闲断网**：在首页拔线，等到一体机刷新（最多约 60 秒），看顶栏。尝试进入确认页下单。保持 ≥6 分钟（超过 5 分钟心跳窗），再插回。
2. **履约中断网**：已付（或免费）任务进度页到「正在打印」后拔线，保持到本地出纸结束或 ≥2 分钟，再插回。观察任务终态是本地打完后补报，还是客户端先报读失败。

不要在断网时杀 Agent（F6）或拔打印机 USB（F4）。

### ② 系统应该怎么反应

Agent：

- claim 网络失败：打日志并跳过本轮，不崩溃（`task-runner.ts:860-888`）。
- 终态 PATCH 失败：写入离线队列，60 秒起退避重试，最多 10 次；4xx 进死信需人工（`offline-queue.ts:4-14,106-123`）。`printing` 上报失败视为信息性，**继续出纸**（`task-runner.ts:437-441`）。
- 心跳失败：进程继续，`failureCounter` 增加（`heartbeat.ts:17-20`）。
- 下载失败：2s/5s/10s 共 4 次，仍失败才 `PRINT_COMMAND_FAILED`（`task-runner.ts:97-126,377-389`）。

服务端：

- 5 分钟无新心跳 → 终端离线，生产拒新单（`printer-availability.ts:45-47,69-70`）。
- `claimed` 超过租约或 `printing` 超过 10 分钟 → `PRINT_JOB_UNCONFIRMED`，`autoRequeued: false`（`terminals-agent.service.ts:778-831`）。
- 微信支付回调走服务端公网，**不依赖一体机网线**。用户手机已付时，订单可以在一体机离线时变成 `paid`（`PrintCashierPage.tsx:7-8,261,336`：网络失败保留上次快照，不伪造状态）。

一体机：

- `GET printer-status` 失败 → `networkLabel: '网络异常'`，`printerLabel: '状态未知'`（`useTerminalDeviceStatus.ts:275-284`）。
- 进度轮询失败：先显示「暂时无法读取状态」（`PrintProgressPage.tsx:127,640-643`）；连续 5 次 → 跳转失败「暂时无法读取状态，请联系工作人员」（`:331-332`）。这是**读状态失败**，不等于服务端已把任务标 failed。
- 10 分钟拿不到终态：标题「暂时查不到打印结果」，正文写明**没有改服务端任务状态**（`:452-501`）。

### ③ 用户在屏幕上应该看到什么

| 位置 | 文案 | 出处 |
|------|------|------|
| 顶栏网络药丸 | `网络异常` | `useTerminalDeviceStatus.ts:171,283`；`KioskDeviceStatusPills.tsx:31-33` |
| 顶栏打印机药丸（请求失败） | `状态未知` | `useTerminalDeviceStatus.ts:173,282` |
| 通用网络错误 | `网络连接失败，请检查网络后重试` | `userErrorMessage.ts:40`；`throwHttpError.ts:44` |
| 收银出发码 | `获取支付通道失败，请检查网络后重试` | `PrintCashierPage.tsx:183` |
| 已付但释放打印任务失败 | `订单已付款，但创建打印任务失败，请重试或联系现场工作人员` | `PrintCashierPage.tsx:129` |
| 进度页读状态 | `暂时无法读取状态` | `PrintProgressPage.tsx:127` |
| 进度页查询超时标题 | `暂时查不到打印结果` | `PrintProgressPage.tsx:454` |
| 进度页查询超时叙述 | `这不代表成功或失败，只是本机暂时没拿到最新状态。` | `PrintProgressPage.tsx:455,487-501` |
| Agent 本机面板 | `云端暂未连接` | `status-panel.ts:59` |
| 收银页退款说明（任何时候都在） | `如需退款请联系现场工作人员协助处理，本机不提供自助退款` | `PrintCashierPage.tsx:76` |

断网时确认页若仍用过期的「打印机在线」缓存（最多 60 秒）：此处应有立即刷新的断网提示（当前实现未见即时推送，只靠 60 秒轮询）。

### ④ 恢复后状态，以及钱和纸

人工：插回网线。Agent 下一轮心跳/claim/离线队列会自己跑，**不必**为了重连而重启服务（重启是 F6）。

| 情况 | 任务 | 钱 | 纸 |
|------|------|----|----|
| 空闲断网 >5 分钟 | 新单 PRT-03 拒绝。插回后心跳恢复即可再下单。 | 拒单则无收款。 | 无。 |
| 已付、本地已出纸、PATCH 曾失败 | 离线队列应补 `completed`。对账：钱已收、纸已出、任务最终 completed → **两清**。 | 已付。 | 已出。 |
| 已付、本地未出纸、下载失败 | `PRINT_COMMAND_FAILED`，可重提。 | 平台欠履约/退款。 | 0。 |
| 一体机先显示读失败，服务端仍在 printing | 插回后点「重新查询状态」或回进度页。**不要**在此刻退款。 | 以服务端 `payStatus`+出口为准。 | 可能仍在出。 |
| 超过 10 分钟仍无终态 | 服务端可能已被 `resetExpiredClaims` 写成 UNCONFIRMED。走 F7。 | 核查前不要退。 | 先看出口。 |

- [ ] 空闲断网：顶栏 `网络异常`：____
- [ ] 空闲断网 >5 分钟：新单被拒：____
- [ ] 履约中断网：本地是否出纸：____ 恢复后任务终态：________
- [ ] 离线队列是否补报成功（Agent 日志 `offline-queue: PATCH ... ✓`）：____

---

## F6 Agent 服务被杀后恢复

### ① 怎么人为制造

**要用杀进程模拟崩溃，不要用干净的 Stop-Service。** 干净停止走 SCM STOP，不会触发 WinSW `onfailure`（`aijobprintagent.xml:9-11`）。

管理员 PowerShell：

```powershell
Get-Service | Where-Object { $_.Name -match 'AIJob|aijobprintagent' } | Format-List Name, Status, StartType
# 记下 SCM Name，常见 aijobprintagent.exe，DisplayName=AIJobPrintAgent
$proc = Get-CimInstance Win32_Service -Filter "Name='aijobprintagent.exe'"  # 名称以现场为准
# 若上面 Filter 不命中，用 Get-Service 的 Name
Get-Process | Where-Object { $_.ProcessName -match 'node|WinSW|aijobprint' } | Format-Table Id, ProcessName
taskkill /F /PID <Agent的PID>
```

做两拍：

1. **空闲杀**：无打印任务时 `taskkill`。等 60 秒看服务是否回到 Running。
2. **打印中杀**：进度页到「正在打印」后立刻杀。看重启后该任务是补报 completed、还是 `PRINT_JOB_UNCONFIRMED`、有没有第二份纸。

不要同时删 `%ProgramData%\AIJobPrintAgent\agent.db`（那会丢掉防重印依据）。

若现场用 `Stop-Service`：**当前无自动拉起**，需人工 `Start-Service`。把这种做法记成「干净停止」，不要记成崩溃恢复通过。

### ② 系统应该怎么反应

- WinSW：第一次失败 60 秒后重启，第二次 300 秒，第三次不再自动重启；失败计数 1 天重置（`aijobprintagent.xml:9-12`）。安装脚本对 SCM 写入同类策略（`install-production-agent.ps1:246-248`）。
- 单实例 PID 锁：活进程在则拒绝第二份 Agent（`instance-lock.ts:5-17`）。崩溃后 PID 失效，新进程可以接管。
- 重启后本地库对账（`task-runner.ts:331-363`），**不会自动再调用打印机**：
  - 本地 `spooled` / `dispatching` → `failed` + `PRINT_JOB_UNCONFIRMED`，文案「打印派发已开始，但无法确认是否已进入队列或完成出纸，请工作人员现场核查」
  - 本地 `completed` / `failed` → 只补报终态
  - 其它未知本地态 → `LOCAL_TASK_STATE_UNKNOWN`，停止自动重试
- 派发前若本地库写不进 `dispatching`：直接失败，不出纸（`task-runner.ts:454-472`）。
- 杀在 claim 成功、`dispatching` 尚未写入：服务端任务仍是 `claimed`，新 Agent **不会**再 claim 已 claimed 的任务；约 5 分钟租约到期后 `resetExpiredClaims` 写成 UNCONFIRMED（`terminals-agent.service.ts:778-805`）。
- 心跳停 → 最多 5 分钟后一体机/拦新单视为离线。

### ③ 用户在屏幕上应该看到什么

空闲杀、心跳已过期：同 F4/F5 的 `打印机离线` / `状态未知` / `本机打印服务暂未就绪…`（见 F4 ③、`printer-availability.ts:69-70`）。

打印中杀、结果为未确认：同 F1 未确认完成页。Agent 内部那句「请工作人员现场核查」**不会**原样出现在用户屏上，用户只看到白名单「打印作业未确认完成，请工作人员检查出纸状态」（`print-jobs.service.ts:112-113,121`）。

进度页在 Agent 已死、API 仍可达时：可能长时间停在「等待终端领取」/「终端已领取任务」（`PrintProgressPage.tsx:138-160`），直到租约/10 分钟超时。

「Agent 已崩溃、正在自动重启」：此处应有提示（当前实现未见）。本机面板若还能打开，可能显示 `云端暂未连接`（`status-panel.ts:59`）；面板进程与 Agent 同生共死，杀了可能连 `http://127.0.0.1:9527/local/panel` 也打不开。

### ④ 恢复后状态，以及钱和纸

| 杀死时机 | 自动重启后 | 钱 | 纸 |
|----------|------------|----|----|
| 空闲 | 服务 Running，心跳恢复，可再下单。 | 无。 | 无。 |
| 已派发（`dispatching`/`spooled`） | UNCONFIRMED，**禁止重提、禁止自动再打**。必须看出口（F7）。 | 已付则核查前两边都可能欠。 | 可能 0、可能已出完、可能还在队列里被 Windows 自己打完。 |
| 本地已 completed，PATCH 未发出 | 补报 completed。 | 已付已出 → 两清。 | 已出。 |
| claim 后、派发前 | 等租约到期 UNCONFIRMED，或任务一直 claimed 直到 5/10 分钟。 | 已付未出 → 平台欠履约/退款。 | 0（除非队列里另有人打）。 |

现场恢复后**先看出纸口和 Get-PrintJob**，再决定 Admin 核查。切勿一看失败就重打。

- [ ] 空闲 `taskkill` 后约 60 秒内服务回到 Running：____
- [ ] 打印中杀：任务终态 / `errorCode`：________ 实出纸：____ 张
- [ ] 有无第二份重复出纸（预期：无）：____
- [ ] 若用了 Stop-Service：已注明「非崩溃路径」：____

---

## F7 支付成功但出纸失败（已付款未出纸）

这是本单最要紧的一条。钱已经在渠道侧收了，纸没有按订单出来。下面把**现有处置**按代码展开，不假设有自动退款。

### ① 怎么人为制造

必须 `amountCents > 0` 的真实/沙箱已付单。免费单记「未执行」。金额用价目允许的最小正价。记下 `orderNo`、`taskId`、实付分。

做 **两条**（代表两种完全不同的售后闸门）。都能做则都做；只能做一条时优先 **B**（未确认是资损高发）。

**F7-A 明确失败、纸没出**（预检拦住，队列尚未接收）：

1. 打印机正常，走完收银，确认 `payStatus=paid`、进度页已出现。
2. **立刻**关打印机电源或拔 USB（F4-A/B），抢在预检前。
3. 等任务 `failed`，日志 `PRINTER_OFFLINE`（或 `PRINTER_NOT_FOUND` / `PRINTER_ERROR`）。
4. 出口确认 0 张。

**F7-B 派发已开始、结果未确认**（禁止重打）：

1. 另开一笔已付单，进度到「正在打印」。
2. 立刻 `taskkill` Agent（F6）或抽光纸并等待监控超时（F1）。
3. 终态必须是 `failed` + `PRINT_JOB_UNCONFIRMED`。
4. 看出口：可能 0 张，也可能已经出完。两种都要记，这正是这条码存在的原因。

不要在核查前点「重新提交打印」、不要在核查前退款、不要删 Agent 本地库。

### ② 系统应该怎么反应

**付款与出纸门：**

- 只有 `paid` 可 claim 出纸；`refunding` / `partial_refunded` / `refunded` 一律不放行（`packages/shared/src/types/payment.ts:22-23`）。
- 收银只有 `paid` 才进进度页（`PrintCashierPage.tsx:11-12`）。
- 已退款到机码在任何状态写入前被拦住，文案「本单已退款，不再出纸…」（`pickup-order.service.ts:96-108`；一体机 `userErrorMessage.ts:46`）。

**打印失败怎么落到订单：**

- Agent PATCH `failed` + `errorCode`；订单 `taskStatus` 随终态更新（`terminals-agent.service.ts:635-638`）。
- 用户只看到 `failureReasonForUser` 白名单（`print-jobs.service.ts:109-129,605-614`）。
- claim 租约到期 / printing 超过 10 分钟：系统写成 UNCONFIRMED，**禁止自动重派**（`terminals-agent.service.ts:801-831`）。

**两条售后闸门不一样：**

| | F7-A 明确失败（如 `PRINTER_OFFLINE` / `PAPER_EMPTY` / `PRINTER_ERROR`） | F7-B `PRINT_JOB_UNCONFIRMED` |
|--|--|--|
| 一体机重提 | 允许：`POST /print/jobs/:taskId/retry`，同一文件、不再计费（`print-jobs.controller.ts:101-118`，`print-jobs.service.ts:667-816`） | **拒绝** `PRINT_RETRY_UNCONFIRMED_FORBIDDEN`：「打印结果未确认，不能重新提交，请联系工作人员核查」（`print-jobs.service.ts:694-700`） |
| Admin 打印扫描「重试该失败任务」 | 可以（`print-scan/index.tsx:397,472-479`） | 禁止；红框「打印结果未确认，禁止重试，避免重复出纸。」（`print-scan/index.tsx:452-461`） |
| Admin 核查出纸 | **不能**走核查接口。核查只接受 `failed` + `PRINT_JOB_UNCONFIRMED` + `paid`（`admin-print-jobs-verify-outcome.service.ts:111-126`） | 必须人工选「已核查·已出纸」或「已核查·未出纸」，确认短语 `VERIFY_PRINTED` / `VERIFY_NOT_PRINTED`（同文件 `:20-21,47-55`；按钮 `apps/admin/src/routes/orders/index.tsx:558-565`） |
| 待退款信号 | 明确失败**不会**自动写 `PAID_UNFULFILLED_PENDING_REFUND`。除非 Admin 把**尚未被 claim 的 pending 孤单**放弃（`admin-print-jobs-abandon.service.ts:45-46,88-90`，本条 F7-A 一般已 claimed，走不进 abandon） | 核查为 `not_printed` 且已付有实收 → CAS 写 `refundReason=PAID_UNFULFILLED_PENDING_REFUND`。**不创建 Refund 行、不调渠道**（`pending-refund-signal.ts:1-8,39-59`；核查 `autoRefund: false`，`admin-print-jobs-verify-outcome.service.ts:31-32,179`） |

**退款（canonical）：**

- 只有管理员 `POST` 走 `RefundService`。渠道三分法：明确成功 / 明确拒绝回滚为 paid / 结果不可知保持 `refunding`（`refund.service.ts:1-26`）。
- `claimed`/`printing` 中不能退：`ORDER_TASK_IN_PROGRESS`（`refund.service.ts:46,294-306`）。
- `printOutcome === 'printed'` 不能退：`PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN`（`refund.service.ts:270-277`）。
- **未核查（`printOutcome` 为空）时，只读接口仍可能 `refundEligible=true`**（`admin-orders-readonly.service.ts:75-76`：`paid && printOutcome !== 'printed'`）。代码**不强制**先核查再退。未确认就退，存在「纸已出、钱也退」的资损。现场纪律：F7-B **先核查，再退款**。
- 退款不会改 `PrintTask` / `printOutcome`（`derived-alerts.ts:101-102,116-117`）。

**取件码：** `paid` 且任务已 `failed` 时不再回给会员（`order-status.service.ts:46-57`）。失败页不是拿码取件。

**进行中退款：** 产品口径「如果退款的话就不出文件」（`pickup-order.service.ts:96-101`）。F7 不要在 `printing` 时退。

### ③ 用户在屏幕上应该看到什么

**一体机完成页（两条共性）：**

| 文案 | 出处 |
|------|------|
| 状态条金额 | `已付 {金额}` | `PrintDonePage.tsx:333,504` |
| 按钮 | `查看费用说明` / `反馈问题` / `返回首页` | `PrintDonePage.tsx:508-511` |
| 费用说明页 | `是否处理费用、处理多少、多久到账，以工作人员核查结果为准，本机不承诺自动处理，也不会替你把费用改成别的数。` | `PrintDonePage.tsx:400-401` |
| 费用说明步骤 | `把订单号…告诉现场工作人员` / `说明实际拿到了几页…已出的纸请一并带上` / `由工作人员现场登记；是否处理、处理多少，以核查结果为准` | `PrintDonePage.tsx:409-411` |
| 完成页底部 | `联系工作人员补打`；可能有「文件带走」二维码 | `PrintDonePage.tsx:583-589` |
| 收银页（始终） | `如需退款请联系现场工作人员协助处理，本机不提供自助退款` | `PrintCashierPage.tsx:76` |
| 进度页 FAQ（已付） | `已支付但打印失败：订单与支付记录已保存，可在「我的 · 打印订单」查看并联系退款。` | `PrintProgressPage.tsx:801` |

**F7-A 明确失败：**

- 标题按码：离线「打印失败」+ 原因「打印机离线，请联系工作人员检查设备」；缺纸/卡纸见 F1/F2。
- 主按钮是 `使用帮助`，不是「联系工作人员核查」（`PrintDonePage.tsx:524-526`）。
- 若 `takeaway.canRetry`：按钮 `重新提交打印`（`:513-522`）。重提失败兜底：`重新提交失败，请联系工作人员补打`（`:328`）。
- **不会**出现「待退款」——那只在 `refundRequired === true` 时显示（`paymentCopy.ts:128-138`，`OrderPaymentSummary.tsx:91-96`）。F7-A 默认没有这个信号。

**F7-B 未确认：**

| 文案 | 出处 |
|------|------|
| 标题 | `打印结果未确认` | `PrintDonePage.tsx:473,502` |
| 主按钮 | `联系工作人员核查` | `PrintDonePage.tsx:525` |
| **没有**「重新提交打印」 | `canRetry && !isUnconfirmed` | `PrintDonePage.tsx:513` |
| 内部码 | `errorCode = PRINT_JOB_UNCONFIRMED` | `PrintDonePage.tsx:577` |

**会员「我的 · 打印订单」**（须登录；匿名当场可能看不到）：

- 核查未出纸并打上信号之后：芯片 `待退款`；说明 `本单已确认未出纸，退款由工作人员处理，到账时间以支付渠道为准`（`paymentCopy.ts:128-131`）。
- **到账天数：此处应有提示（当前实现未见）。** 代码明确不承诺天数。
- 再打印按钮旁：`再打印从「我的文档」重新选择文件发起，将创建新的打印任务与订单`（`OrderPaymentSummary.tsx:109`）——这是**新单新钱**，不是免费重提。

**Admin 订单：**

| 文案 | 出处 |
|------|------|
| 筛选 | `已支付失败待核查` / `待退款（已付款未出纸）` | `orders/index.tsx:410,415` |
| 核查按钮 | `已核查·已出纸` / `已核查·未出纸` | `:558-565` |
| 已出纸后 | `已核查：现场确认已出纸。不可退款、不可重新排队。` | `:607` |
| 未出纸 + 待退款 | `已核查：现场确认未出纸。系统已标记待退款，不会自动出款；请走下方全额退款。不可重新排队。` | `:612-616` |
| 待退款横幅 | `待退款：已付款但未出纸` / `金额以本页服务端金额为准。系统不会自动出款，请走下方全额退款。` | `:621-624` |
| 退款按钮 | `发起退款`；确认 `确认向支付渠道发起退款？这是对外资金动作，点确认后才会出款。` | `:827-848` |
| 打印扫描详情（未核查 UNCONFIRMED） | `打印结果未确认，禁止重试，避免重复出纸。请先核对现场出纸情况，再前往订单管理核查，并按实际情况决定是否全额退款。` | `print-scan/index.tsx:454-460` |

一体机**没有**自助退款按钮。用户侧「联系退款」等于找人。

### ④ 恢复后状态，以及钱和纸

先看出口，再动账。对账只用三件事：渠道是否已收、出口实出几张、任务 `errorCode`/`printOutcome`。

**F7-A（明确失败，出口 0 张）：**

```
用户：已付钱，未拿到纸。
平台：欠用户「免费重提一次」或「全额退款」二者之一，不能既不打也不退。
系统：不会自动选。
现场：恢复打印机 → 用户或 Admin 重提（不再收费）→ 出纸 → 两清。
      或 Admin 全额退款（填原因，点确认）→ 渠道原路退 → payStatus=refunded → 两清，且到机码不再出纸。
禁止：重提成功后又退款（变成平台欠那次纸的成本，用户两边得利）。
```

**F7-B（未确认）：**

```
1. 出口有完整纸、页数对：
   Admin 输入 VERIFY_PRINTED → printOutcome=printed。
   钱：用户已付；纸：用户已拿 → 两清。
   不可退、不可重排。
   若此时仍退款：RefundService 应拒绝 PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN。

2. 出口 0 张（或残页不足以构成履约）：
   Admin 输入 VERIFY_NOT_PRINTED → printOutcome=not_printed，refundRequired=true。
   会员侧可出现「待退款」。
   钱：平台仍欠退款，直到 Admin 点「确认发起退款」且渠道 SUCCESS。
   纸：不欠（没出）。不可重排。用户若还要纸，走新单新钱。

3. 出了一部分：
   代码的核查只有 printed / not_printed 两档，没有「部分出纸」。
   当前无自动处置，需人工介入：按现场纪律二选一（整单视为已出纸不退，或视为未履约全额退、已出的纸收回），并写进本单备注。不要让系统「补打剩余页」——没有这个接口。
```

**退款发起之后（两条共用）：**

- `refunding`：钱在路上。超过 30 分钟仍停住，按 `docs/operations/wechat-refund-exception-handling-sop.md` 人工查，不要再点一次换新 `refundNo`。
- `refunded`：渠道欠用户的钱已还。到机码拒绝出纸。
- 渠道明确拒绝：订单回到 `paid`，可同号重试或改线下记账。

**绝对不要做的：**

1. UNCONFIRMED 未看出纸口就重打 → 可能两份纸、一次钱。
2. UNCONFIRMED 未核查就退款 → 可能一份纸、钱也退。
3. 把完成页「加纸后继续打印不需要重新下单」当成 F7 流程。
4. 把会员「去我的文档再打印」当成免费补打。

- [ ] F7-A：`orderNo` ________ `errorCode` ________ 实出 ____ 张 处置（重提/退款）：________ 最终 `payStatus`：________
- [ ] F7-B：`orderNo` ________ 出口实况：________ 核查短语：________ `printOutcome` ________ 是否出现待退款：____ 是否发起退款：____ 最终 `payStatus`：________
- [ ] 有无重复出纸：____ 有无「纸已出且已退款」：____（预期都是无）

---

## 3. 现场记录总表

| ID | 制造动作 | 实际 errorCode / 心跳 | 屏幕文案与白名单一致？ | 实出纸 | 最终 payStatus | 通过 | 备注 |
|----|----------|----------------------|------------------------|--------|----------------|------|------|
| F1 | | | | | | | |
| F2 | | | | | | | |
| F3 | | | | | | 本条「通过」= 已证实无自动缺粉处置且人工换粉后能打 | |
| F4-A 断电 | | | | | | | |
| F4-B USB | | | | | | | |
| F5 空闲 | | | | | | | |
| F5 履约中 | | | | | | | |
| F6 空闲杀 | | | | | | | |
| F6 打印中杀 | | | | | | | |
| F7-A | | | | | | | |
| F7-B | | | | | | | |

未做的格子写「未执行」和原因。禁止把未执行画成通过。

---

## 4. 这份脚本执行后仍不能宣称什么

即使上表全绿，也**不能**宣称：

1. **物理设备 GO / 打印扫描首期验收完成 / 可无人值守商用。** 本单只补 EV-013 点名的故障恢复记录；顺利路径、扫描、U 盘、彩色双面翻页方向、支付全渠道异常不在范围内。
2. **本机型已经能可靠识别缺纸、卡纸、缺粉。** F1/F2 在奔图上很可能只验到了 UNCONFIRMED 兜底；F3 验的是「系统本来就不会管低墨」。
3. **队列 completed / PrintService 307 等于纸到了用户手里。** 代码自己否定这一点。
4. **系统会自动退款。** 待退款是标记；出款必须管理员确认。未核查的 UNCONFIRMED 甚至还可能被误退。
5. **补纸 / 清卡纸 / 换粉 / 插电之后，同一任务会接着打。** 失败即终态。要么重提（明确失败且已付），要么新单，要么退款。
6. **一体机会显示「墨粉不足」。** 当前实现明确禁止。
7. **Admin 告警「心跳超 3 分钟」与真实离线窗一致。** 真实窗口是 5 分钟。
8. **完成页「加纸后继续打印不需要重新下单」是可执行流程。** 那是现存文案，与 `failed` 终态和重提/核查闸门不一致；本单把它当对照项，不当操作手册。
9. **奔图开放打印 API、云端远程扫描、A3、彩色开放 API mode 已随本单验收。** 与 EV-013 相同：本单走本地 Windows 驱动。
10. **生产已按本单处置过真实用户的钱。** 本单是验收脚本。真实售后仍按退款 SOP 与现场纪律，不把本单样本订单当生产对账完成。

本单全部格子画勾之后，唯一可以写进证据台账的句子是：

> 已在指定一体机上按 F1–F7 人为制造故障并留下记录；其中缺粉无自动处置、已付款未出纸无自动退款，均已按人工路径走通。不能单独证明顺利出纸，也不能单独构成物理设备 GO。
