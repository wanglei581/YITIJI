# 对稿清单

屏上扫描（K1b）、屏上复印（C3）的每个运行状态，对到本目录补稿的哪一屏、哪个参数，一致还是有差异。2026-11-08 出；同日产品负责人对末节列的 10 处回了「按推荐」，10 处已定，稿已照改（见末节「11/08 产品负责人定（按推荐）」）。只放稿和清单，没改程序。

- 运行页代码：分支 `claude/copy-kiosk-c3-1105` 头 `02a97c42b`（含屏上扫描 K1b 和屏上复印 C3，叠放 PR #1602、#1607，还没进 main）。下表代码位置相对 `apps/kiosk/src/pages/`，行号逐个实查过。
- 稿：本目录 `copyscan.js`，屏 ID 以 `cs-` 开头，打开办法见 `README.md`（`index.html?shot=1&参数#屏ID`）。`scan-type`、`scan-guide`、`scan-result` 是定稿 `../kiosk-touch-2026-10/fix-scan.js` 里的面板扫描屏。
- 对照一栏：「一致」＝屏上的字、出路、按钮、版式对得上；「有差异」写差在哪；**补（11/08）**＝这次照代码事实补的稿；「不补」写原因。
- 截图在 `~/.cache/claude-lanes/copyscan-1102/code-shots/drafts-quota-1108/`（第一轮）和 `drafts-quota-1108-r2/`（第二轮改过的屏），本机，不进仓库。

## 每屏都有的差异（下表不再逐行写）

1. 服务电话：稿写示意号码 183-6916-1921，没有服务时间，行首带电话图标；程序从后台读，写「需要帮助？拨打服务电话 号码（服务时间）」，读不到整行不显示，出错屏这一行没有图标（`print-scan/phoneHelp.tsx:9–13`）。
2. 检查时间：稿胶囊写「扫描仪就绪 · 20 秒前检查」「设备就绪 · 20 秒前检查」；程序固定写「扫描仪就绪 · 刚刚检查」（`scan/scanProbeCopy.ts:7–10`、`copy/CopyShell.tsx:26`）。
3. 程序屏上扫描各屏的意图带左上角多一个圆形返回键，稿不画。
4. 「原件怎么放」动画（11/04 补稿，待看）程序没做，玻璃台和进纸器都是静态图。
5. 状态未知的胶囊：程序是灰色，稿是橙色；11/08 定用橙色，扫描、复印各处一致（程序要改）。11/09 程序已改（PR #1611）：屏上扫描各屏、复印各屏用橙色；面板「扫什么」的正在确认 / 能力状态暂不可用、等回传的正在发送取消请求三处仍是灰色（属定稿 `fix-scan.js`），待定。
6. 小青接不上：扫描各屏程序和稿同一句；复印外壳里没找到这句（`copy/CopyShell.tsx` 没接，推断复印各屏不显示），稿复印各屏照样显示。

## 屏上扫描

| 运行状态 | 代码位置（文件:行） | 稿屏（参数） | 对照 |
|---|---|---|---|
| 扫什么 · 正在确认扫描能力 | `scan/ScanStartPage.tsx:77,104–131,181–197` | 定稿 `scan-type`（读取中，定稿没有演示入口） | 有差异：副题多「，请查看说明或改用其他方式」，首格多「扫描服务还没确认。」，程序多面板四步路径线，「改用面板扫描到 U 盘」行是灰的 |
| 扫什么 · 扫描能力暂未开放 | `scan/ScanStartPage.tsx:50–61,81–98` | 定稿 `scan-type`（演示「暂未开放」） | 有差异：首格正文程序用后台写的说明，定稿固定一句；其余同上 |
| 扫什么 · 能力状态暂不可用（读取失败） | `scan/ScanStartPage.tsx:57–58,92–95` | 定稿 `scan-type`（演示「能力读不到」） | 有差异：同「正在确认」 |
| 扫什么 · 一种都没选 | `scan/ScanStartPage.tsx:67–76,150–154,261–287` | **`cs-scan-what?mat=none` 补（11/08）** | 有差异：程序还多副题「请先选择一种材料。本页尚未创建任务。」、U 盘灰行、两格说明「这一步」「未登录」，胶囊写「可创建扫描任务 · 需面板操作」；稿只画主按钮「先选一种材料」灰、无箭头 |
| 扫什么 · 已选材料 | `scan/ScanStartPage.tsx:155–175` | `cs-scan-what?mat=resume`／`id`／`doc`／`contract` | 有差异：同上多出来的几样 |
| 扫描到 U 盘说明（只有 `?mode=usb-panel` 能开） | `scan/ScanStartPage.tsx:199–216` | 定稿 `scan-type` 的 U 盘说明 | 有差异：程序第二格写「在打印机屏幕上选」，定稿还写着打印机品牌 |
| 怎么扫 · 检查中 | `scan/ScanHowPage.tsx:87–107,145–147`；`scan/scanProbeCopy.ts:66,71` | **`cs-scan-how?scanner=capcheck`／`checking` 补** | 一致 |
| 怎么扫 · 就绪（游客） | `scan/ScanHowPage.tsx:93–105,151–161,186–236` | `cs-scan-how` | 有差异：改选面板后程序卡下多一句「下一步会真实建立这次扫描」；选面板点「下一步」程序直接建面板会话进 `scan-guide`，稿去 `scan-type` |
| 怎么扫 · 已登录、登录回来续接 | `scan/ScanHowPage.tsx:57–84,226`；`scan/scanHowContinue.ts:10,37–47` | `cs-scan-how?login=1` | 一致 |
| 怎么扫 · 扫描仪状态过期 | `scan/scanProbeCopy.ts:77–79` | `cs-scan-how?scanner=stale` | 有差异：程序「扫描仪状态超过 1 分钟没更新，先用面板扫描」，胶囊也是这整句；稿写「2 分钟」，胶囊「扫描仪状态过期 · 2 分钟前」 |
| 怎么扫 · 其余检查结论（能力读不到、本机程序连不上、状态未知、正忙、没找到、出错） | `scan/scanProbeCopy.ts:68,72–76,80` | **`cs-scan-how?scanner=capfail`／`unreachable`／`unknown`／`busy`／`notfound`／`error` 补** | 一致 |
| 屏上扫描未开通 | `scan/ScanHowPage.tsx:86,132–142,151–184,237–243`；`scan/useScanDeviceCapability.ts:30–35` | `cs-scan-off` | 有差异：程序多「下一步会真实建立这次扫描」；卡和主按钮直接建面板会话进 `scan-guide`（稿去 `scan-type`）；稿另有 `cs-scan-how?scandev=off`，程序不用这种 |
| 放纸设置 · 就绪 | `scan/ScanDeviceSettingsPage.tsx:57–146` | `cs-scan-set` | 有差异：只有通用差异 2、4 |
| 放纸设置 · 正在确认扫描仪 | `scan/ScanDeviceSettingsPage.tsx:42–49,65–67` | **`cs-scan-set?scanner=checking` 补** | 一致 |
| 放纸设置 · 过期或没开通 | `scan/ScanDeviceSettingsPage.tsx:42–49` | `cs-scan-set?scanner=stale`／`?scandev=off` | 有差异：程序自动退回「怎么扫」；稿留在本屏写原因、开始扫描变灰 |
| 放纸设置 · 正在开始 | `scan/ScanDeviceSettingsPage.tsx:75–77`；`scan/useScanDeviceStart.ts:77–90` | **`cs-scan-set?start=busy` 补** | 一致 |
| 放纸设置 · 没建成（服务端明确拒绝） | `scan/useScanDeviceStart.ts:22,88,110`；`scan/ScanDeviceSettingsPage.tsx:147` | **`cs-scan-set?start=rejected` 补** | 一致 |
| 放纸设置 · 开始前断网 | `scan/useScanDeviceStart.ts:20–21,67–74,106–109,136–144` | **`cs-scan-set?start=offline` 补** | 一致。11/08 定：用程序现状（留在本屏，提示行一句，开始扫描灰 60 秒），11/04 的独立断网屏不采用、已删 |
| 放纸设置 · 出错后返回（恢复态） | `scan/ScanDeviceErrorPage.tsx:32–35,41`；`scan/ScanDeviceSettingsPage.tsx:31–37,77–83` | `cs-scan-set` | 有差异：程序这里的「返回」回出错屏，稿回「怎么扫」 |
| 已交给机器 · 等扫描仪回报开始 | `scan/scanDeviceState.ts:96,181–183`；`scan/ScanDeviceRunView.tsx:49–56,79–107` | **`cs-scan-run?run=waiting` 补** | 一致 |
| 正在扫描 · 扫描仪不报页数 | `scan/scanDeviceState.ts:99,169`；`scan/ScanDeviceRunView.tsx:54–56,75–113` | `cs-scan-run?pages=none` | 一致 |
| 正在扫描 · 有页数 | `scan/ScanDeviceRunView.tsx:75,81–87,103–110` | `cs-scan-run` | 一致 |
| 停止 · 点第一下 | `scan/ScanDeviceStopButton.tsx:27,42–49`；`scan/useScanDeviceFlow.ts:73–77,255–262` | `cs-scan-run`／`-more`／`-make`／`-unknown` 点一下停止 | 一致 |
| 停止 · 第二下在途 | `scan/useScanDeviceFlow.ts:207–228`；`scan/scanDeviceStopState.ts:71–102` | `cs-scan-unknown`（停止键变「正在停止」） | 有差异：稿在正在扫描、这一页、生成文件上点第二下直接到 `cs-scan-stopped`；程序先到「状态未知 · 正在停止」，两边都确认才进已停止 |
| 这一页扫好了（玻璃台） | `scan/scanDeviceState.ts:170–172`；`scan/ScanDeviceMoreView.tsx:32–96` | `cs-scan-more` | 有差异：程序提醒「最多 N 页；10 分钟内没操作会自动结束」，没有「，并删除已扫的页」；上限按云端回报（稿固定 20） |
| 这一页扫好了 · 到上限 | `scan/ScanDeviceMoreView.tsx:32,75,79` | `cs-scan-more`（演示加到 20 页） | 一致 |
| 这一页扫好了 · 不报页数或上限 | `scan/ScanDeviceMoreView.tsx:33–36,71,87,102–103` | **`cs-scan-more?pages=none` 补** | 字一致；程序格子里只有「这一页已扫好」一句，稿放玻璃台大图把格子占住 |
| 这一页扫好了 · 命令在途 | `scan/ScanDeviceMoreView.tsx:61,75,83`；`scan/useScanDeviceFlow.ts:175–205` | **`cs-scan-more?busy=1` 补** | 一致；回包不明时进 `cs-scan-unknown` |
| 正在生成文件 · 合成中 | `scan/scanDeviceState.ts:174–176`；`scan/ScanDeviceMakeView.tsx:25–69` | `cs-scan-make` | 一致 |
| 正在生成文件 · 传回中、不报页数 | `scan/ScanDeviceMakeView.tsx:40–66` | **`cs-scan-make?make=delivering`／`?pages=none` 补** | 一致 |
| 扫描完成 · 游客 | `ScanWorkbenchPage.tsx:95–96`；`scan/ScanDeviceDonePage.tsx:50–153`；`scan/scanGuestWays.ts:11–24` | `cs-scan-done` | 游客段一致：11/08 定用程序的「带走的办法」三条，替掉稿上旧两句。其余有差异：程序是真实预览加「整屏查看」，稿画分页小图；文件信息程序「PDF · 856 KB · 3 页」，稿「3 页 · 1.1 MB」；原件提醒图标程序是文件、稿是手 |
| 扫描完成 · 已登录且已存进「我的文档」 | `scan/ScanDeviceDonePage.tsx:32–48,56–58,119,137–143` | `cs-scan-done?login=1`（演示事件切小程序发布与否） | 字一致；稿已存句前有文件夹图标，程序没有 |
| 扫描完成 · 已登录但还没核对到是本人的 | `scan/ScanDeviceDonePage.tsx:32–48,109,119,137` | **`cs-scan-done?login=1&owned=0` 补** | 一致 |
| 扫描完成 · 预览打不开 | `scan/ScanDeviceDonePage.tsx:95–101`；`../components/PdfCanvasPreview.tsx:22`；`../components/FileContentPreview.tsx:118–119,207` | **`cs-scan-done?preview=fail` 补** | 一致：留在完成屏、只换预览区一句，出路照常。11/08 定：用程序现状，11/04 的独立失效屏不采用、已删。非 PDF 时程序那句是「这份文件无法在本页内嵌预览；预览失败不代表文件本身有问题，文件状态以页面上的文件卡为准。」 |
| 扫描完成 · 整屏查看层 | `scan/ScanDeviceDonePage.tsx:103–105,154–160`；`scan/ScanResultPreviewViewer.tsx:111–238` | 定稿 `scan-result` 的「整屏查看」层 | 不补：查看层定稿已有，补稿完成屏只差一颗「整屏查看」按钮，等游客段口径定了一起改；程序层里的字（「第 N 页 / 共 M 页」「上一页」「下一页」「适应整页」「适应宽度」「关闭预览，回到这一步」）和定稿不同 |
| 出错 · 进纸器里没有纸 | `scan/scanDeviceState.ts:32`；`scan/scanDeviceErrorCopy.ts:5–10`；`scan/ScanDeviceErrorPage.tsx:41–76` | `cs-scan-err-nopaper` | 字一致；「改用玻璃台」程序原地改玻璃台并立刻重开（稿回 `cs-scan-set`）；「改用面板扫描」把这一场转成面板进 `scan-guide`（稿去 `scan-type`） |
| 出错 · 卡纸或盖板没合上（卡纸、开盖同一屏） | `scan/scanDeviceState.ts:33`；`scan/scanDeviceErrorCopy.ts:11–16` | `cs-scan-err-jam` | 一致（面板去向同上） |
| 出错 · 打印机正在忙 | `scan/scanDeviceState.ts:34`；`scan/scanDeviceErrorCopy.ts:17–21`；`scan/ScanDeviceErrorPage.tsx:73,76` | `cs-scan-err-busy` | 有差异：稿这屏也画了服务电话行，说明栏却写「不放服务电话句」，程序照说明不画 |
| 出错 · 扫描仪没有响应 | `scan/scanDeviceState.ts:35`；`scan/scanDeviceErrorCopy.ts:22–26` | `cs-scan-err-noresp` | 有差异：程序删了「我们已经收到提醒，会尽快处理。」（没有告警证据不承诺，`scan/scanDeviceErrorCopy.ts:3`） |
| 出错 · 等太久没有结果 | `scan/scanDeviceState.ts:36`；`scan/scanDeviceErrorCopy.ts:27–31` | `cs-scan-timeout` | 有差异：程序首句「这次没有扫出文件。」，稿「超过 3 分钟没有收到扫描结果」（设备报超时不证明等满 3 分钟）；「重新开始」程序清登记回「扫什么」、不预选材料 |
| 出错屏 · 处理中 | `scan/ScanDeviceErrorPage.tsx:44,59–60`；`scan/useScanDeviceFlow.ts:230–242` | **五张出错屏 `?busy=1` 补** | 一致 |
| 已停止扫描 · 有倒计时 | `scan/ScanDeviceFlowPage.tsx:15`；`scan/ScanDeviceStoppedPage.tsx:16–38`；`scan/scanDeviceStopState.ts:14–31` | `cs-scan-stopped` | 有差异：秒数按服务端时间（稿固定 90）；删页那半句看本机回包才出现 |
| 已停止扫描 · 没有服务端时间、没确认删页 | `scan/ScanDeviceStoppedPage.tsx:22,30–32` | **`cs-scan-stopped?quiet=none`／`?purged=0` 补** | 一致 |
| 状态未知 · 结果还没确认 | `scan/scanDeviceState.ts:95,100,132,147,163–168,173,178–184`；`scan/ScanDeviceUnknownView.tsx:15–54`；`scan/scanDeviceRecovery.ts:27–32` | `cs-scan-unknown` | 字一致。11/08 定：右栏留白改版——大纸居中、说明放在纸下面、整块拉开，字号句子出路都没变（程序要照改版式） |
| 状态未知 · 本机程序连不上（断网时云端连续两次查不到也是这句） | `scan/useScanDeviceFlow.ts:126–129`；`scan/ScanDeviceUnknownView.tsx:15–16` | `cs-scan-unknown?unknown=unreachable` | 一致。11/08 定：断网用程序现状（进状态未知、每 3 秒自动重查、恢复后自动换屏），11/04 的独立断网屏不采用、已删 |
| 状态未知 · 停止没确认 | `scan/useScanDeviceFlow.ts:61–69,82,110,254`；`scan/ScanDeviceStopButton.tsx:33` | `cs-scan-unknown`（演示「停止结果未确认」） | 画面一致；程序拿到停止回执后不再查云端，这一屏不会自己变，稿说明写的是等云端回报 |
| 中断 · 扫描未完成（云端失败或取消、设备中止、预热、超过大小、投递被拒） | `scan/scanDeviceState.ts:117–159`；`scan/useScanDeviceStart.ts:151–160`；`scan/ScanResultPage.tsx:66–80`；`scan/ScanDeviceFailedView.tsx:15–96`；`scan/scanDeliveryAck.ts:124–126` | **`cs-scan-failed`**（`?reason=stopped`／`warming`／`large`／`ack`） | 一致。11/08 定屏上扫描自己的结果屏；11/09 定（按推荐）稿跟程序：原因卡单栏居中、大插画在上，原因卡下一句「把原件重新放好，可以照原设置再扫一次。」，出路「照原设置再扫一次」（回 `cs-scan-set` 预填）与「返回首页」，删「同一张纸…」「这是一次普通新会话…」两句；`?view=now` 去掉 |
| 中断 · 等待超时（会话过期） | `scan/scanDeviceState.ts:111–116`；`scan/ScanDeviceFailedView.tsx:46–50` | **`cs-scan-failed?fail=expired`** | 一致，同上 |
| 文件失效 · 完成但结果里没有文件 | `scan/scanDeviceState.ts:103–109`；`scan/ScanDeviceFailedView.tsx:45–50,86–90` | **`cs-scan-failed?fail=nofile`** | 一致。11/08 定：用程序现状这一种结果（没有「返回首页」），11/04 的独立失效屏不采用、已删；11/09 起出路和主按钮是「照原设置再扫一次」 |
| 中断后照原设置再扫一次 | `scan/ScanDeviceFailedView.tsx:52–55`；`scan/scanWorkbenchSession.ts:381–399`；`scan/ScanDeviceSettingsPage.tsx:29–40` | `cs-scan-set`（从 `cs-scan-failed` 点「照原设置再扫一次」进，材料、纸放哪、黑白还是彩色照上次） | 一致：只预填这三样界面选项，按「开始扫描」才建普通新会话，不带重扫头。屏上扫描没有安全重扫凭据，11/09 起 `cs-scan-failed?rescan=lost` 已去掉（面板扫描那一屏仍在定稿 `scan-result`） |
| 小青接不上 | `scan/ScanWorkbenchChrome.tsx:278`；`print-scan/AiDownNote.tsx:7–13` | 各屏 `?ai=down` | 一致；只有 11/04 三张出错补稿写的是「小青也要联网，恢复后再问」 |
| 离开（导航、问小青、返回） | `scan/ScanWorkbenchChrome.tsx:201–206,218–219,252–256,264–268`；`scan/scanSessionRevoke.ts:187–203` | 各屏底部导航 | 不出屏：直接走，只撤云端任务、清本机登记，已有结果时不撤 |
| 闲置清场 | `scan/useScanDeviceFlow.ts:71`；`../auth/kioskIdleTiming.ts:6–8`；`../auth/KioskPrivacyGuard.tsx:650–668` | 定稿全局「无操作提醒」（说明栏「演示：无操作提醒」） | 不在扫描页里画；等扫描仪、正在扫描、这一页、生成中、状态未知、出错几屏有忙碌锁，不计时 |
| 转去面板扫描（三处入口） | `scan/ScanStartPage.tsx:29–45`、`scan/ScanHowPage.tsx:112–123`；`scan/scanDeviceRecovery.ts:34–48,74–86`；`scan/useScanResultRescan.ts:106–148` | 定稿 `scan-guide` | 有差异：补稿这几处都去 `scan-type`（带材料预选），程序直接进 `scan-guide` |

## 屏上复印

| 运行状态 | 代码位置（文件:行） | 稿屏（参数） | 对照 |
|---|---|---|---|
| 怎么复印 · 就绪 | `copy/CopyWorkbenchPage.tsx:20–21,43,64–70`；`copy/CopyWays.tsx:19–30` | `cs-copy-how` | 有差异：只有通用差异 2 |
| 怎么复印 · 检查中 | `copy/useCopyFlow.ts:45–46`；`scan/scanProbeCopy.ts:66,71` | **`cs-copy-how?scanner=capcheck`／`checking` 补** | 一致（字换成复印） |
| 怎么复印 · 能力读不到、本机程序连不上、状态未知、正忙、没找到、出错 | `copy/useCopyFlow.ts:45–46`；`scan/scanProbeCopy.ts:68,72–80` | **`cs-copy-how?scanner=capfail`／`unreachable`／`unknown`／`busy`／`notfound`／`error` 补** | 一致 |
| 怎么复印 · 扫描仪状态过期 | `copy/useCopyFlow.ts:45–46` | `cs-copy-how?scanner=stale` | 有差异：程序「扫描仪状态超过 1 分钟没更新，先用面板复印」，胶囊同句；稿写「2 分钟」 |
| 怎么复印 · 打印机离线 | `copy/useCopyFlow.ts:47` | `cs-copy-how?printer=down` | 有差异：程序胶囊和屏上卡都写「打印机离线」；稿屏上卡写「这台机器暂时打不了，先用面板复印」 |
| 怎么复印 · 打印机状态读不到 | `copy/useCopyFlow.ts:47` | **`cs-copy-how?printer=unknown` 补** | 一致 |
| 怎么复印 · 网络断开 | `copy/CopyWorkbenchPage.tsx:42`；`../copy/unattendedCopy.ts:175–177` | **`cs-copy-how?net=off` 补** | 一致（这句是项目统一的断网标准句） |
| 怎么复印 · 屏上复印没开通 | `copy/CopyWorkbenchPage.tsx:20–21,43–44,65–66`；`copy/CopyWays.tsx:19–30` | `cs-copy-off` | 有差异：副题「面板上的复印、身份证复印、票据复印都能用。」程序只在打印机就绪时出现 |
| 放好原件 · 就绪 | `copy/CopyWorkbenchPage.tsx:64–72`；`copy/CopySettingsView.tsx:6–43` | `cs-copy-set` | 有差异：默认程序 1 份、黑白、单面，稿 2 份、黑白、双面；通用差异 4 |
| 放好原件 · 彩色或双面没开通 | `copy/CopySettingsView.tsx:34,38` | `cs-copy-set?color=off`／`?duplex=off` | 一致 |
| 放好原件 · 正在建单 | `copy/CopyWorkbenchPage.tsx:51,67–68`；`copy/copySession.ts:72–75` | **`cs-copy-set?start=busy` 补** | 有差异：程序还把四组设置锁住，稿只画开始复印变灰 |
| 放好原件 · 超过这台机器能收的大小 | `copy/useCopyFlow.ts:64`；`copy/copySession.ts:95–101` | **`cs-copy-set?start=limit` 补** | 一致 |
| 放好原件 · 建单结果没确认 | `copy/useCopyFlow.ts:64`；`copy/copySession.ts:95–101`；`copy/CopyWorkbenchPage.tsx:49–51,72` | **`cs-copy-set?start=unknown` 补** | 有差异：程序把四组设置锁住，开始复印仍可点。胶囊 11/09 起两边都写「状态未知」、状态未知色调（稿原来画「设备就绪 · 20 秒前检查」，照程序改） |
| 放好原件 · 建单回包缺凭据 | `copy/copySession.ts:91–92`；`copy/CopyWorkbenchPage.tsx:43–44,73–75` | **`cs-copy-unknown?why=token` 补** | 有差异：程序标题「状态未知」、胶囊却是「扫描仪就绪 · 刚刚检查」。11/08 定：胶囊和标题一致写「状态未知」，稿就是这样画的，程序要改 |
| 放好原件 · 检查中、过期以外的检查结论、打印机读不到、网络断开 | `copy/CopyWorkbenchPage.tsx:42,67–68,72` | **`cs-copy-set?scanner=…`／`?printer=unknown`／`?net=off` 补** | 一致：原因写在设置下面的提示行，开始复印灰 |
| 放好原件 · 打印机离线 | `copy/CopyWorkbenchPage.tsx:67–68,72` | `cs-copy-set?printer=down` | 有差异：程序提示行只写「打印机离线」；稿写「这台机器暂时打不了，我们已经收到提醒，会尽快处理……」（程序不承诺已收到提醒） |
| 建单被拒（能力关掉）→ 没开通屏 | `copy/useCopyFlow.ts:63–65`；`copy/CopyWorkbenchPage.tsx:45–49` | `cs-copy-off` | 一致 |
| 扫原件 · 等扫描仪回报开始 | `copy/CopyDeviceView.tsx:46–48`；`scan/ScanDeviceRunView.tsx:71–113` | **`cs-copy-scan?run=waiting` 补** | 一致 |
| 扫原件 · 扫描中（有页数、不报页数） | `copy/CopyDeviceView.tsx:42–48,60–61` | `cs-copy-scan`／`?pages=none` | 一致 |
| 扫原件 · 整理成预览 | `copy/CopyDeviceView.tsx:46–48`；`copy/copyCheckModel.ts:43–48` | **`cs-copy-scan?run=finishing` 补** | 一致（不报页数时大字照程序写「正在扫描」） |
| 这一页扫好了（玻璃台） | `copy/CopyDeviceView.tsx:41–59`；`copy/copyCheckModel.ts:46` | **`cs-copy-more` 补** | 一致：一张「再扫一页」卡，主按钮「扫完了」。11/08 定：不加「扫完了，整理成预览」卡；稿多画了已收到的页小图（程序只写「已收到 N 页」） |
| 这一页扫好了 · 不报页数、命令在途 | `copy/CopyDeviceView.tsx:57–59` | **`cs-copy-more?pages=none`／`?busy=1` 补** | 一致 |
| 停止 · 点两下 | `copy/CopyDeviceView.tsx:23–27,34–38,44`；`scan/ScanDeviceStopButton.tsx:27` | `cs-copy-scan`「停止复印」 | 一致 |
| 已停止复印 | `copy/copyDeviceFlow.ts:214–231`；`copy/CopyDeviceView.tsx:40–63` | `cs-scan-stopped?flow=copy` | 11/08 定：复印没有静默期，稿去掉 90 秒倒计时，补原件提醒「原件还在玻璃上或进纸器里，请带走」，配玻璃台、进纸器示意；程序现在正文只一句「已停止复印，已扫的页已从这台机器删除。」，要补原件提醒 |
| 状态未知 · 结果没确认、等太久没新结果、停止没确认 | `copy/copyDeviceFlow.ts:22,49–51,55–58,231`；`copy/CopyDeviceView.tsx:40–63` | **`cs-copy-unknown`／`?why=wait`／`?why=stop` 补** | 字一致；程序正文只有一句。11/08 定：和屏上扫描一起改版（大纸居中、说明在下、整块拉开）；复印这屏有「返回」 |
| 出错 · 缺纸、卡纸或开盖、忙、没响应、超时 | `copy/copyPrintModel.ts:9–16`；`copy/CopyErrorView.tsx:16–51` | `cs-scan-err-nopaper`／`-jam`／`-busy`／`-noresp`、`cs-scan-timeout`（从复印进时换写法） | 有差异：程序复印出错屏都没有「返回」；「打印机正在忙」程序出路是「再试」「改用面板复印」，稿是「再试」「取消」 |
| 出错 · 处理中 | `copy/CopyErrorView.tsx:31,39` | 五张出错屏 `?busy=1` 补 | 一致（程序复印这几屏没有返回键） |
| 出错 · 超过这台机器能收的大小 | `copy/copyPrintModel.ts:14`；`copy/CopyErrorView.tsx:26–29,45` | **`cs-copy-err-limit` 补** | 字一致。11/08 定：问小青改「问小青：原件太多怎么复印」（程序现在借「扫描仪连不上怎么办」，要改） |
| 出错 · 中途没开通（授权失效、单子过期） | `copy/copyPrintModel.ts:15`；`copy/copyDeviceFlow.ts:170–173`；`copy/CopyErrorView.tsx:26–39` | **`cs-copy-err-off` 补** | 字一致。11/08 定：问小青用复印没开通屏的原句「问小青：面板上怎么复印」（程序要改） |
| 核对 · 就绪 | `copy/CopyDeviceView.tsx:42–56`；`copy/CopyCheckView.tsx:27–49` | `cs-copy-check` | 用纸一致：11/08 定双面照程序按份取整（3 页双面 × 2 份 = 4 张，`copy/copyCheckModel.ts:4–6`），稿已改。还有差异：程序没有「发现身份证号等个人信息时，会先问你保留还是遮挡」「扫描件只在这台机器上，打印完就删除」两条，只有「扫描件只在这台机器上处理，不上传」 |
| 核对 · 正在读取预览、预览打不开 | `copy/CopyCheckView.tsx:34` | **`cs-copy-check?preview=loading`／`fail` 补** | 一致 |
| 核对 · 超过三页按组翻 | `copy/CopyCheckView.tsx:36–40` | **`cs-copy-check?cpages=7` 补** | 有差异：翻组键照定稿打印预览的 `.pager`（`screens.js:1057`），程序是文字键「上一组」「下一组」 |
| 核对 · 报价已更新、奇数页多份双面没开通、报价暂时无法确认 | `copy/copyDeviceFlow.ts:155–159,165–166`；`copy/copyCheckModel.ts:7–10`；`copy/CopyDeviceView.tsx:55–56` | **`cs-copy-check?quote=changed`／`odd`／`none` 补** | 一致；程序完全拿不到核对数据时正文只剩「报价暂时无法确认」一句（`copy/CopyDeviceView.tsx:56`），稿画的是有核对数据、价格那格读不到的那种 |
| 核对 · 价格大于 0 | `copy/CopyCheckView.tsx:44,47`；`copy/copyDeviceFlow.ts:166` | 不补 | 涉及价格：照 CLAUDE.md §1 收费口径，价格不进仓库、首版不出现价格；程序这一态写「这台机器暂不支持付费复印，请重扫或返回。」 |
| 核对 · 网络断开 | `copy/CopyDeviceView.tsx:52–53` | **`cs-copy-check?net=off` 补** | 一致 |
| 核对 · 打印机离线 | `copy/CopyDeviceView.tsx:52–53` | `cs-copy-check?printer=down` | 有差异：程序只把主按钮写成「打印机离线」并变灰，没有提示行；稿多一段「这台机器暂时打不了……我们已经收到提醒……」 |
| 超过免费额度（游客单次、本人每日、整机每日） | `copy/copyDeviceFlow.ts:160–164`；`copy/CopyDeviceView.tsx:31`；`copy/CopyQuotaView.tsx:17–47`；`copy/copyQuotaCopy.ts:21–41` | **`cs-copy-quota?quota=guest`／`member`／`terminal` 补**（从 `cs-copy-check` 演示「演示：超过免费额度」进） | 一致；面数示意 20／50，和运行页截图一样 |
| 超过免费额度 · 后台没给面数 | `copy/copyCheckModel.ts:36–40`；`copy/copyQuotaCopy.ts:26,32` | **`cs-copy-quota?limit=none` 补** | 一致 |
| 已确认（一瞬间） | `copy/copyDeviceFlow.ts:150`；`copy/CopyDeviceView.tsx:42–48` | 不补 | 确认后马上进打印，只闪一帧 |
| 正在打印 | `copy/CopyPrintView.tsx:18–33` | `cs-copy-print?stage=2` | 有差异：程序三段（已收到 → 正在交给打印机 → 已交给打印机），第一段也会是进行中；没有「打印机正在出纸」那一段和出纸动画（没有证据就不说在出纸），稿默认画的正是「打印机正在出纸」 |
| 请到出纸口取走复印件 | `copy/CopyPrintView.tsx:34–39` | `cs-copy-done` | 一致（电话那半句程序有号码才出） |
| 这次没收到打印结果 | `copy/CopyPrintView.tsx:39–51` | `cs-copy-unconfirmed` | 有差异：胶囊程序「结果未确认」（灰），稿「没收到打印结果」（橙）；程序多「这次不会自动重打，也不会重复收费」和原件提醒；电话那一步和电话卡只在有号码时出现 |
| 打印失败 | `copy/CopyErrorView.tsx:26–51`（打印中出错） | **`cs-copy-failed` 补** | 一致 |
| 闲置 180 秒、单子到期 | `copy/useCopyFlow.ts:24–43`；`copy/copyDeviceFlow.ts:65–68` | 不出屏 | 清场后回「怎么复印？」 |
| 离开（导航、问小青、返回） | `copy/CopyShell.tsx:22,29–30` | 各屏底部导航 | 不出屏：清场，没派发打印时同时撤销云端单 |

## 缺稿结论

这次补了 7 张新屏和已有屏的 30 多种样子（参数见 `README.md` 末节），都照运行页原句画；第一轮没带新参数时，原来的屏逐像素和 main 一样；第二轮按 11/08 定案改了的屏见末节。

- 新屏：`cs-copy-quota`（额度用完，三种说法）、`cs-copy-more`、`cs-copy-unknown`、`cs-copy-failed`、`cs-copy-err-limit`、`cs-copy-err-off`、`cs-scan-failed`。
- 新样子：扫什么一种都没选；怎么扫／怎么复印的检查中与六种检查结论、打印机读不到、网络断开；放纸设置的正在确认、正在开始、没建成、开始前断网；放好原件的正在建单、超过大小、结果没确认；两条流程的等扫描仪、复印整理成预览；这一页的不报页数和命令在途；生成文件的传回中和不报页数；扫描完成的游客三条出路、已登录未核对、预览打不开；出错屏处理中；已停止的没有服务端时间和没确认删页；核对屏的读取中、预览打不开、按组翻、三种报价情况、网络断开。
- 不补的（原因在表里）：整屏查看层（定稿已有）、核对屏价格大于 0（价格不进仓库）、已确认那一帧、闲置清场与离开（全局层，定稿已有无操作提醒）、扫什么的能力读取三态与 U 盘说明（定稿 `scan-type` 已有）。完成屏登记里缺文件时程序整屏空白（`scan/ScanDeviceDonePage.tsx:50` 返回空），正常路径到不了，不画。

新元素的出处：额度说明的点列和单栏居中照运行页 `copy/copy-print.css:27–31`（定稿和本目录搜过「额度」「免登录」「每日上限」「0 点恢复」，没有同类）；原件提醒绿条用本目录 `cs-copy-done` 的 `.cs-help`；翻组键用定稿 `screens.js:1057` 的 `.pager`；读取中转圈用本目录 `.cs-spin`；中断结果屏的说明格和扫描小样照定稿 `fix-scan.js` 的 fs- 部件与运行页 `scan/styles/scan-fs.css:228–252`；状态未知、复印状态未知的大纸版式照 11/04 的 `cs-scan-unknown`。

## 稿有、程序没有

1. 11/04 的 `cs-scan-offline`、`cs-scan-file-gone` 两张整屏：11/08 定用程序现状，不采用，已从稿里删掉。
2. 新的中断结果屏 `cs-scan-failed`（11/08 定稿）：11/09 程序已改成屏上扫描自己的结果屏（PR #1611），稿也照 11/09 定案跟程序改了（见末句），`?view=now` 已去掉。
3. `cs-scan-how?scandev=off` 的样子、`cs-scan-set` 过期或没开通时留在本屏：程序分别换成 `cs-scan-off`、自动退回「怎么扫」。
4. 胶囊里的「· 20 秒前检查」「过期 · 2 分钟前」：程序固定「刚刚检查」，过期句整句放进胶囊。
5. 「原件怎么放」动画（11/04 待看）。
6. 停止点第二下直接到已停止、固定 90 秒、总说已删页：程序先到「状态未知 · 正在停止」，秒数和删页看回执。
7. 「改用玻璃台」回放纸设置、「到打印机面板上扫／改用面板扫描」去 `scan-type`：程序分别是原地重开、进 `scan-guide`。
8. 停止没确认后「等云端回报」：程序拿到停止回执后不再查。
9. 程序有意删掉的三句：超时「超过 3 分钟没有收到扫描结果」、没响应「我们已经收到提醒，会尽快处理。」、这一页「，并删除已扫的页」；以及打印机离线时的「我们已经收到提醒，会尽快处理」长句。
10. 复印：「打印机正在出纸」那一段和出纸动画；核对屏「会先问你保留还是遮挡」「打印完就删除」两条；复印已停止的原件提醒（11/08 定要补）；复印出错屏的「返回」；忙屏的「取消」。

## 11/08 产品负责人定（按推荐）

产品负责人 11/08 在协调窗口对上一版末节列的 10 处回了「按推荐」。稿已照改，程序随后照稿改（本 PR 不改程序）。

1. 游客扫描完成：用程序的「带走的办法」三条，作为游客默认样子。稿上：`cs-scan-done` 游客段换成三条，旧两句删掉；第三条后半句「，手机小程序里也能看到」只在小程序发布后出现；`?guest=ways` 参数不再需要，已去掉。
2. 屏上扫描中断后，改成屏上扫描自己的结果屏。稿上：`cs-scan-failed` 新默认眉题「屏上扫描」，不画面板四步路径线；原因卡写这次的原因和「同一张纸原样再扫，系统可能按重复件拒收（两小时内）。」；出路「重试扫描（同一份材料）」回 `cs-scan-set`、「重新开始一次扫描」回 `cs-scan-what`、「返回首页」；问小青「扫描失败怎么办」，有服务电话行。现在程序的样子留在 `?view=now`，标「现在程序的样子（待改）」。
3. 断网、文件失效：用程序现状。稿上：11/04 的 `cs-scan-offline`、`cs-scan-file-gone` 不采用，已从 `copyscan.js`、分组和流程里删掉；程序现状对应的 `cs-scan-set?start=offline`、`cs-scan-unknown?unknown=unreachable`、`cs-scan-failed?fail=nofile`、`cs-scan-done?preview=fail` 保留。
4. 复印停止：去掉 90 秒倒计时（程序没有静默期，画了就是假的），补原件提醒。稿上：`cs-scan-stopped?flow=copy` 只剩「已停止复印，已扫的页已从这台机器删除」、大提醒「原件还在玻璃上或进纸器里，请带走」和玻璃台、进纸器两张现成插画；问小青用复印各屏已有的「怎么复印更合适」。
5. `cs-copy-more` 删掉「扫完了，整理成预览」卡，底部主按钮「扫完了」保留。稿上：只剩「再扫一页」一张卡，已收到的页小图放大、整块上下拉开。
6. 问小青句：`cs-copy-err-limit` 改「问小青：原件太多怎么复印」，`cs-copy-err-off` 改「问小青：面板上怎么复印」（沿用复印没开通屏原句）。
7. 复印建单回包缺凭据：胶囊和标题一致写「状态未知」。稿上本来就这样画（`cs-copy-unknown?why=token`），程序要改。
8. 双面用纸照程序按份取整：3 页双面 × 2 份 = 4 张。稿上：`cs-copy-check` 改成按每份页数除以二向上取整再乘份数。
9. 状态未知胶囊用橙色，扫描、复印各处一致。稿上本来就是橙色（`cs-scan-unknown`、`cs-copy-unknown`、`cs-copy-unconfirmed`），程序要改。
10. 状态未知两屏右栏留白改版：用这个状态已有的说明和出路把内容拉开，不放大字号、不加新信息。稿上：`cs-scan-unknown`、`cs-copy-unknown` 的大纸从左栏改到居中，「状态未知」和那一句放在纸下面，整块上下拉开；句子、字号、底栏出路（停止键、问小青、复印的返回）都没变。

11/09 第三轮：三屏留白修整——`cs-copy-more`（三种样子）已收到的页那一格撑满上部、最后两页画成大页、「下一页」占位改成两页下面一整条，`cs-scan-failed?fail=nofile` 原因卡照单栏居中、插画放大把卡撑满，`cs-scan-stopped?flow=copy` 三块按正文间距排、玻璃台和进纸器两张插画改上下排并放大；字、出路都没动，其余屏与上一版逐像素一致。

11/09 第四轮（产品负责人 11/09 在问答框定四项，都选推荐）：1）屏上扫描中断结果屏的「再扫一次」改成「照原设置再扫一次」，回 `cs-scan-set`，材料、怎么扫和放纸设置照上一场预填，按开始扫描才建一场普通新会话（不带重扫头、不写「同一份材料」）；2）删掉原因卡「同一张纸原样再扫，系统可能按重复件拒收（两小时内）。」和出路卡「这是一次普通新会话，不是免查重的重扫。不自动重扫。」，换成「把原件重新放好，可以照原设置再扫一次。」「回到放纸设置，材料和设置照上次填好」（屏上扫描每次拼出的 PDF 字节都不同，服务端同字节去重拦不到）；面板扫描失败屏里的同类句子不动；3）原因卡单栏居中、大插画在上（原因句也均衡断行，「…这次先停在这里。」不再把「里。」单独甩到下一行，程序与稿同改），复印「建单结果没确认」胶囊写「状态未知」，都照程序，稿跟着改：`cs-scan-failed` 各样子、`cs-copy-set?start=unknown` 的胶囊；`?rescan=lost`、`?view=now` 两种样子去掉；4）#1612 已合。其余屏与上一版逐像素一致（只有右上角实时时钟不同）。
