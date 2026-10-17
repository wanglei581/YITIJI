# 小程序全量走查矩阵（2026-10-16 起）

> 格式参照 [`kiosk-full-walkthrough-2026-09-27.md`](kiosk-full-walkthrough-2026-09-27.md)。现状汇总写在 `docs/progress/current-progress.md`，这里是逐页明细，不另立账本。
> 范围：`apps/miniapp/app.json` 注册的 44 页（主包 5 + 分包 39，底部 4 个 Tab）。停放的 20 页不注册、不打包，不在本表。

## 证据口径（三类，不混算）

- **已见实际**：有人真看到过。注明是开发者工具实际模拟器截图还是用户手机，并写清源版本。
  - 开发者工具当前源码基线：`cfbe56784`（主项目 `claude/miniapp-main` 的 HEAD；不是「已发布正式版」）。
  - 候选：`689047e9f`、`8242781fa`、VIS1 的 `0205742fc`、OPS1+VIS2 的 `696437f28`。
  - 后台 webview 的 AX 树不算可见截图。CUA 坐标点击偶发 noWindowsAvailable，不记成产品按钮坏。
- **仅代码检查**：只从源码推断入口、状态分支和测试覆盖。没人看过实际效果，不能当作通过。
- **待真机**：必须在手机上看。例如下单后的系统返回、图片预览、下载中途返回。

截图证据清单（都在 `commercial-closeout-20261016/claude-exec/evidence/`）：
- `ui-audit-2106/capture-manifest.json`：源码基线 `cfbe56784` 的运行效果，开发者工具 iPhone 12/13 (Pro)，截图 01–32 及 b 张，含每张的 SHA-256 和观察。`31a-kiosk-scan-native-picker.png` 是扫码打开的原生选图器，不算路由截图。`01-orders-before.png` 实际拍到的是首页，作废。
- `ui-audit-vis1-0205742fc/manifest.json`：VIS1 候选 `0205742fc` 的运行效果，6 张，含主项目切换前后的 SHA。
- `ui-audit-ops1-696437f28/manifest.json`：OPS1+VIS2 候选 `696437f28` 的运行效果，5 张；面试设置是用临时只读启动模式看的，不算首页跳转验收。

## 概况（截至 10/17 09:55，取自下面三份清单）

- 已见实际：37 页，只是初始态或只读态。开发者工具模拟器 31 页，用户手机 7 页，两者重叠 1 页（订单列表）。
- 其余 7 页仅代码检查：选服务点、材料包确认、材料包到机码、面试作答、面试报告、简历解析、发送到一体机。它们要有效任务、材料包或扫码发文件才进得去，受数据门禁约束。
- **只读走查不等于全功能通过**：没下单、没生成、没提交、没扫有效码。
- P1 三条：
  - 订单页、诊断页：VIS1 候选实屏局部通过；
  - 简历优化入口死路：#1473 已修，候选实屏局部通过（两个入口、上传落点）。
- P2 待排（多数归入 VIS3）：
  - 订单详情主按钮贴边；
  - 返回箭头在部分页面稳定看不见；返回按钮没有无障碍名称；
  - 滚动后内容进到状态栏和胶囊下面（AI 工具、意见反馈、打印 Tab）；今日提醒日期被胶囊盖住；
  - 帮助 FAQ 文字贴左；U盘指引格式标签贴卡片左边；打印 Tab 层级重复，「今日提醒」写死「登录后查看」；
  - 扫码登录一体机页突然换成深绿奶油配色，深绿底上黑色状态栏字难读；自我探索说明很长，露出「E3」「服务端拒绝」等实现用语；
  - 组包「下一步」在一份没选时看着可点；AI 服务记录空态没有去使用的入口；助手问候态就显示「保存本次要点」；
  - 首页密度；简历搭建首屏；语音简历文字模式题面；职业规划孤字。
- 代码层面：
  - 5 页未检出直接的页级测试覆盖（只按文件名和引用检索，可能有关联测试间接覆盖，待核实）：简历搭建、语音简历、求职材料、关于、今日提醒。
  - 10 页 js 超过 500 行，其中材料包确认 1112 行、打印确认 970 行、取件页 819 行，这三页超过 800 行。按 CLAUDE.md §8 不再往里堆功能，取件页列入拆分。
  - #1473 合入后简历优化是 503 行，成为第 11 页。已评估过拆分：可拆的是导出、计价、核销这一块（付费相关的已验证代码），不在界面批次里拆，列入拆分清单。

## 批次

| 批 | 页面 | 内容 | 状态 |
|---|---|---|---|
| 预览修复 | 打印预览、我的文档 | 每次现取签名链接、失败说清原因、返回不留遮罩 | #1469 `689047e9f`。手机上两个 PDF 入口 PASS |
| B1 / B2 / 修订 | 取件页、订单列表、订单详情、确认页 | 按钮用语、主次、信息卡、返回路径、下单后重建页面栈 | #1470 `8242781fa`。手机查看路径两项 PASS；下单后系统返回待真机 |
| VIS1 | 订单列表、诊断报告 | 首屏空卡、到机码折行、单件「加载更多」、导出只在完成态、按钮越界根因 | #1472 `0205742fc`。候选实屏局部通过（Codex，开发者工具实际模拟器，用户本人登录）。CI：smoke 红在一体机 `kiosk-session-warning.spec.ts:142`，和 #1469 是同一条用例，22:18 交 Grok 归类 |
| OPS1 + VIS2 | 简历优化、面试入口 | 入口死路改走「我的简历 / 上传新简历」；失败态加「选择其他简历」；上传落点改为选文件页；时长选项写清、选项块居中 | #1473 `696437f28`。第一版方案 agy 判需修改已撤；冷审阻断（上传落到解析页报错）已修；agy 重核：可以出候选。CI 全绿。实屏局部通过：无任务页两个入口、上传落点、面试选项居中与时长题数、点选高亮。不算通过：上传页返回图标看不见、首页到面试的跳转、空态开始提示 |
| VIS3（待预算） | 优先（用户 22:2x 指定，已有实图证实）：滚动进状态栏和胶囊（AI 工具、意见反馈、打印 Tab）；部分页返回箭头稳定看不见并补无障碍返回名称；今日提醒日期被胶囊盖住；帮助卡片内边距；首页和 AI 工具入口层级；语音简历文字模式。其次：订单详情主按钮贴边、组包「下一步」、AI 服务记录空态、助手初态、职业规划孤字、打印 Tab 文案、U盘指引标签、扫码登录配色、自我探索用语 | 按现有组件和全局样式找共享根因，不逐页打补丁；不删已验证功能 | 未开工；先报文件预算，交 agy 审方案，再实现 |
| 另起一批 | 诊断、职业规划、岗位匹配 | RESUME_TASK 没有账号归属 | 未开工 |

## 跨页待核

1. **返回箭头可见性**（不假设同一个根因，不先改全局图标）：
   - 稳定截图里看得见：设置、帮助、隐私、AI 服务记录、岗位匹配、自我探索、U盘指引。
   - 看不见：诊断（候选 02）、订单详情（候选 10）、简历上传（13）、消息通知（14）、我的简历（24b，稳定后仍看不见）、关于（26）。
   - 先前缺失的截图有的可能是首帧，要取稳定后的截图复看。
   - 代码：54 页共用 `ficon i-right nav-back-ic`。`app.wxss` 里 `.navbar .nav-back` 是 48px，`.nav-back-ic` 旋转 180°，图标是 `.i-right` 的 mask 图。扫码登录、发送到一体机两页用别的写法。
   - 先逐页取稳定截图和渲染尺寸，再定根因。
2. **返回按钮没有无障碍名称**：多数是没有名称的空 view，读屏和 AX 工具都找不到，坐标工具又反复 noWindowsAvailable。
   - 微信官方文档（aria-component，基础库 2.7.1 起）规定角色属性叫 `aria-role`。仓库里 `role=` 有 248 处、`aria-role=` 只有 2 处。
   - 56 个返回键里 39 个没有 `aria-label`，17 个写的是 `role="button"`。
   - VIS3 统一成 `aria-role="button" aria-label="返回"`，先报预算。读屏的实际效果要在手机上验。
3. **状态栏与胶囊**：
   - 滚动后内容进到状态栏和胶囊下面，页头跟着滚走：AI 工具（04b）、意见反馈（20b）、打印 Tab（16b）。
   - 今日提醒右侧日期被胶囊盖住（23）。
   - 根因待核。
4. **RESUME_TASK 没有账号归属**：诊断页「查看上一次的诊断（文件名）」，以及职业规划、岗位匹配无任务时都读它。服务端按归属拒绝（`AI_TASK_NOT_FOUND`）；残留风险是同一部手机换号后能看到上一位的文件名。
5. **AI 额度用完**：服务端提示「可以先按模板手动填写」，但优化页失败态没有去模板的入口。
6. **配色突变**：扫码登录一体机（31）从蓝色突然换成深绿奶油，深绿底上黑色状态栏字难读。
7. **工具限制，不算产品缺陷**：
   - CUA 坐标点击偶发 noWindowsAvailable；
   - 底栏「打印」坐标点击几次不响应，改用文本节点能进入。

## 逐页矩阵

| 页面 | 入口（代码） | 模板状态分支（代码） | 证据 | 视觉问题 | 操作问题 | 严重度 | 修复 | 测试；规模 |
|---|---|---|---|---|---|---|---|---|
| 首页<br>`pages/home/home` | 底部 Tab；TabBar, about, ai-records, assistant, career-plan, daily-report 等 | （模板无状态分支） | 已见实际｜模拟器 cfbe567：03-home-top-before（已登录、有一笔待到机） | 入口层级密集；待取件副标题被截断 | — | P2 | VIS3 | page-lifecycle、print-flow-ux、verify-miniapp-static 等；js 170 行 |
| 启动/登录<br>`pages/launch/launch` | ai-records, career-plan, daily-report, documents, feedback, job-fit 等 | 锁定 | 已见实际｜模拟器 cfbe567：32-launch-before（从扫码登录一体机「去登录」进入） | 版面完整 | 没勾协议前登录按钮不可用；没勾协议、没提交登录 | — | — | ai-access、page-lifecycle、session-generation 等；js 270 行 |
| AI 工具（Tab）<br>`pages/ai/ai` | 底部 Tab；TabBar, assistant, daily-report, help, home | （模板无状态分支） | 已见实际｜模拟器 cfbe567：04-ai-before、04b-ai-lower-before | 分组标题与说明贴左、没和卡片对齐；顶部说明和入口密集；滚动后内容跑到状态栏和微信胶囊下面（截图所见，根因待核） | — | P2 | VIS3 | verify-miniapp-static、verify-package-layout；js 140 行 |
| 打印（Tab）<br>`pages/print/print` | 底部 Tab；TabBar, assistant, daily-report, home, resume-diagnose | （模板无状态分支） | 已见实际｜模拟器 cfbe567：16-print-before（Codex 当时记为已登录）、16b-print-lower-before（下半屏；**运行时已是未登录态，不能算已登录截图**） | 初屏引导、步骤、大入口卡层级重复；下滚后内容穿进状态栏和微信胶囊下面 | 「今日提醒」的「登录后查看」在 `print.js:25` 写死（代码），已登录时也这么写，待已登录运行复测；底栏坐标点击几次不响应，改用文本节点能进入（工具限制） | P2 | VIS3 | free-pilot-copy、verify-miniapp-static、verify-package-layout；js 60 行 |
| 我的（Tab）<br>`pages/me/me` | 底部 Tab；TabBar, assistant, daily-report, feedback, home | 失败、未登录 | 已见实际｜模拟器 候选 0205742fc：09-me-current（未登录态）<br>已见实际｜模拟器 cfbe567：15-me-auth-before（已登录：0 简历、17 文档、9 订单） | — | — | — | — | me-stats、print-flow-ux、verify-miniapp-static 等；js 171 行 |
| AI 助手<br>`pages/assistant/assistant` | ai, home | 加载、锁定 | 已见实际｜模拟器 cfbe567：11-assistant-before（问候态） | 只有问候就显著显示「保存本次要点」大按钮 | 待核：只有问候时该不该显示、能不能点（未点，未发 AI 请求） | P2 | VIS3 待核 | page-lifecycle；js 330 行 |
| 材料包·组包<br>`pages/package-create/package-create` | orders, package-confirm, print, store-select | 分页、加载、失败、完成、未登录 | 已见实际｜模拟器 cfbe567：17-package-create-before、17b-package-empty-next-before（一份没选） | 一份没选时「下一步」是蓝色可点的样子 | 点了提示「请先选择文件」、留在本页、没建单：可用性待优化，不是漏校验 | P2 | VIS3 | free-pilot-copy、package-order-idempotency、page-lifecycle 等；js 553 行 ⚠ 超 500 |
| 材料包·选服务点<br>`pages/store-select/store-select` | package-confirm, package-create | 加载、失败、空 | 仅代码检查 | 待截图 | 待走查 | — | — | package-order-idempotency、page-lifecycle、verify-miniapp-static 等；js 186 行 |
| 材料包·确认<br>`pages/package-confirm/package-confirm` | store-select | 加载、失败、完成、未登录 | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、package-order-idempotency、page-lifecycle 等；js 1112 行 ⚠ 超 800 |
| 材料包·到机码<br>`pages/package-code/package-code` | home, orders, package-confirm | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、home-pickup-summary、package-order-idempotency 等；js 457 行 |
| 打印·上传参数<br>`pages/print-upload/print-upload` | assistant, career-plan, documents, interview-qa, interview-result, job-fit 等 | 加载、失败、完成 | 已见实际｜手机 689047e9f：「查看原文」入口；03439f5 下单时走过 | 待截图 | 待走查 | — | — | free-pilot-copy、page-lifecycle、print-flow-ux 等；js 302 行 |
| 打印·选终端<br>`pages/print-store/print-store` | print-upload | 加载、失败、完成、空 | 已见实际｜手机 03439f5（旧源）：COLOR / DUPLEX / OFFLINE 下单时走过 | 待截图 | 待走查 | — | — | free-pilot-copy、page-lifecycle、print-capabilities 等；js 289 行 |
| 打印·确认<br>`pages/print-pay/print-pay` | print-store | 加载、失败、未登录、锁定 | 已见实际｜手机 03439f5（旧源）：同上 | 待截图 | 待走查 | — | — | free-pilot-copy、page-lifecycle、price-confirmation 等；js 970 行 ⚠ 超 800 |
| 打印·到机码/取件<br>`pages/print-pickup/print-pickup` | home, orders, print-pay | 加载、失败、完成、未登录 | 已见实际｜手机 03439f5（旧源）：同上；8242781fa 查看路径（用户未逐页记录） | 待截图 | 待走查 | — | — | free-pilot-copy、home-pickup-summary、page-lifecycle 等；js 819 行 ⚠ 超 800 |
| 简历搭建<br>`pages/resume-build/resume-build` | ai, ai-records, resume-voice | 加载、失败、完成、未登录 | 已见实际｜模拟器 cfbe567：05-resume-build-before（空表单） | 语音替代入口和大段说明先占首屏，基本字段靠下 | — | P2 | VIS3 | 未检出直接页级覆盖（待核实关联测试）；js 555 行 ⚠ 超 500 |
| 语音简历<br>`pages/resume-voice/resume-voice` | ai, home, resume-build | 失败、完成 | 已见实际｜模拟器 cfbe567：07、07b（未勾选录音 → 用手打进入第一题） | 文字模式题面仍写「请说出你的姓名」「转成文字后」 | 文字兜底入口本身可用（已观察） | P2 | VIS3 | 未检出直接页级覆盖（待核实关联测试）；js 387 行 |
| 简历上传<br>`pages/resume-upload/resume-upload` | assistant, career-plan, job-fit, resume-diagnose, resume-parse, resumes 等 | （模板无状态分支） | 已见实际｜模拟器 cfbe567：13-resume-upload-before | 返回箭头看不见 | 返回没确认（坐标工具 noWindowsAvailable）；本页是 #1473 的上传落点，选文件入口无条件显示（代码） | P2 | VIS3（返回逐页取证） | verify-miniapp-static；#1473 起 ai-entry-fixes 也测这一页的落点；js 128 行 |
| AI 诊断报告<br>`pages/resume-diagnose/resume-diagnose` | ai, ai-records, assistant, home, resume-parse, resumes | 加载、失败、完成、禁用、空 | 已见实际｜模拟器 cfbe567：02-diagnose-before（空态）<br>已见实际｜模拟器 候选 0205742fc：02-diagnose-after（空态） | 改前：无报告却有整块禁用导出卡、并排按钮越屏、空态与主按钮之间大片空白。候选：已消失；返回箭头在这张里看不明显（根因与候选关系未确认） | 改前：空态主操作离说明太远。候选：主按钮贴近说明 | P1 | VIS1 #1472 `0205742fc`：候选实屏局部通过 | ai-records-qa、free-pilot-copy、page-lifecycle 等，#1472 加 vis-layout；js 343 行 |
| 简历优化<br>`pages/resume-optimize/resume-optimize` | ai, ai-records, assistant, home, job-fit, resume-diagnose 等 | 加载、失败、完成、禁用 | 已见实际｜模拟器 cfbe567：06-resume-optimize-before（从 AI 工具正常进入） | — | 改前：无 taskId 时只有「未指定优化任务／请从简历诊断页发起」和「返回」，入口是死路；失败态「重新上传简历」跳解析页落到报错 | P1 | OPS1 #1473 `696437f`：只给「从我的简历选择 / 上传新简历」，不读缓存；失败态加「选择其他简历」；上传落点改为选文件页。agy 重核可以出候选；候选截图待 Codex | free-pilot-copy、verify-miniapp-static；#1473 加 ai-entry-fixes（13 条）；js 498 行（#1473 后 503 行，已评估拆分） |
| 模拟面试·设置<br>`pages/interview-entry/interview-entry` | ai, assistant, home, interview-result, job-fit | （模板无状态分支） | 已见实际｜模拟器 cfbe567：08-interview-entry-before（空表单） | 选择控件文字贴顶、下半块空白；「练习时长」标签与按题数写的选项对不上 | — | P2 | VIS2 #1473：选项写时长和题数、选项块纵向居中；全页同类控件只有这一处没居中 | page-lifecycle；#1473 加 ai-entry-fixes；js 79 行（#1473 后 80 行） |
| 模拟面试·作答<br>`pages/interview-qa/interview-qa` | interview-entry | 加载、失败 | 仅代码检查 | 待截图 | 待走查 | — | — | page-lifecycle；js 202 行 |
| 模拟面试·报告<br>`pages/interview-result/interview-result` | ai-records, interview-qa | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | interview-result-compliance、page-lifecycle；js 121 行 |
| 职业规划<br>`pages/career-plan/career-plan` | ai, ai-records, assistant, home | 加载、失败、完成 | 已见实际｜模拟器 cfbe567：12-career-plan-before（无简历空态） | 说明折行后剩一个孤字 | 上传入口能到简历上传页；无任务时读没有归属的 RESUME_TASK（代码，另起一批） | P3 | VIS3（文案） | self-explore-consent-items、verify-miniapp-static；js 250 行 |
| 自我探索<br>`pages/self-explore/self-explore` | ai, ai-records, career-plan | 加载、失败、完成、锁定 | 已见实际｜模拟器 cfbe567：29-self-explore-before（只看介绍和同意说明） | 说明很长；露出「E3」「服务端拒绝」等实现用语；返回箭头可见 | 没同意、没作答、没发 AI 请求；AX 返回回到 AI 工具。以后精简必须保留同意内容 | P2 | VIS3（用语） | self-explore-consent-items、verify-miniapp-static；js 780 行 ⚠ 超 500 |
| 岗位匹配参考<br>`pages/job-fit/job-fit` | ai, ai-records, assistant | 加载、失败、完成 | 已见实际｜模拟器 cfbe567：28-job-fit-before（无简历空态） | 返回箭头可见 | 上传入口可见；返回 AI 工具可用；无任务时读没有归属的 RESUME_TASK（代码，另起一批） | — | — | verify-miniapp-static、verify-review-scope；js 354 行 |
| 打印预览<br>`pages/print-preview/print-preview` | print-upload | 加载 | 已见实际｜手机 689047e9f：「打开原文查看」PDF 完整、返回无残留遮罩 | 待截图 | 待走查 | — | — | file-preview、free-pilot-copy、page-lifecycle 等；js 181 行 |
| U盘打印指引<br>`pages/usb-import/usb-import` | print | （模板无状态分支） | 已见实际｜模拟器 cfbe567：30-usb-import-before | 格式标签贴在卡片左边；返回箭头可见 | 没打印、没导入 | P3 | VIS3 | page-lifecycle；js 28 行 |
| 简历解析<br>`pages/resume-parse/resume-parse` | resume-diagnose, resume-optimize, resume-upload | 失败、完成、锁定 | 仅代码检查 | 待截图 | 不带 fileId 进入停在「缺少待解析的简历文件」（代码；#1473 起优化页不再直接跳这里） | — | — | page-lifecycle、verify-miniapp-static；#1473 起 ai-entry-fixes 用它做反例；js 756 行 ⚠ 超 500 |
| 我的简历<br>`pages/resumes/resumes` | me | 分页、加载、失败、未登录 | 已见实际｜模拟器 cfbe567：24-resumes-before、24b-resumes-settled-before（0 份空态） | 稳定后返回箭头仍看不见 | 点左上区域能回「我的」；空态主按钮合理 | P2 | VIS3（返回逐页取证） | list-load-more、verify-miniapp-static；#1473 起 ai-entry-fixes 也测这一页的落点；js 183 行 |
| 我的文档<br>`pages/documents/documents` | ai, home, launch, me, order-detail, orders 等 | 分页、加载、失败、锁定 | 已见实际｜手机 689047e9f / 8242781fa：预览 PDF 完整、返回正常 | 待截图 | 待走查 | — | — | file-preview、page-lifecycle、print-flow-ux 等；js 468 行 |
| 求职材料<br>`pages/job-materials/job-materials` | ai | 加载、失败、空 | 已见实际｜模拟器 cfbe567：27-job-materials-before（模板目录）、27b-job-materials-form-before（校园求职信空表单） | 表单每个字段一张独立大卡片 | 空表单时「生成」不可用；没填、没生成；坐标返回没确认（工具限制） | P3 | VIS3 待定 | 未检出直接页级覆盖（待核实关联测试）；js 145 行 |
| 打印订单<br>`pages/orders/orders` | home, me, notifications, order-detail, package-code, package-confirm 等 | 分页、加载、失败、完成、未登录、空 | 已见实际｜模拟器 cfbe567：01-orders-actual-before<br>已见实际｜手机 8242781fa：查看已完成 COLOR / DUPLEX 与待到机 PAPER 单（只看不下单）<br>已见实际｜模拟器 候选 0205742fc：01-orders-after、01b-orders-pending-after、01c-orders-empty-filter-after（用户本人登录） | 改前：材料包 0 笔大空卡占首屏；到机码和标签折行；字小、卡里套卡。候选：单件在前、码一行、材料包空态一行 | 改前：真实订单被挤到下面。候选：「待取件」筛选一笔 PAPER 加紧凑空行；「打印中」筛选零单件、提示切到全部 | P1 | VIS1 #1472 `0205742fc`：候选实屏局部通过 | free-pilot-copy、page-lifecycle、print-flow-ux 等，#1472 加 vis-layout；js 539 行 ⚠ 超 500 |
| 订单详情<br>`pages/order-detail/order-detail` | orders | 加载、失败 | 已见实际｜模拟器 候选 0205742fc：10-order-detail-current（只读打开） | 主按钮贴到屏幕左右边缘；返回箭头看不明显 | 点左上返回区能回到同一个「待取件」筛选 | P2 | VIS3（不认定为 VIS1 回归） | free-pilot-copy、order-detail-refresh、page-lifecycle 等；js 593 行 ⚠ 超 500 |
| AI 服务记录<br>`pages/ai-records/ai-records` | ai, assistant, me, notifications, resume-parse | 加载、失败、未登录 | 已见实际｜模拟器 cfbe567：25-ai-records-before（空态） | 返回箭头可见 | 空态没有直接去使用的入口；返回可用 | P2 | VIS3 | ai-records-qa、page-lifecycle、verify-miniapp-static；js 384 行 |
| 设置<br>`pages/settings/settings` | me | 未登录 | 已见实际｜模拟器 cfbe567：18-settings-before | 稳定渲染后返回箭头可见 | — | — | — | verify-miniapp-static；js 61 行 |
| 隐私与数据<br>`pages/privacy/privacy` | feedback, settings | 加载、失败、未登录、空 | 已见实际｜模拟器 cfbe567：21-privacy-before | 返回箭头可见 | 反馈→隐私→法务可达；坐标返回 noWindowsAvailable（工具限制），返回没确认 | — | — | free-pilot-copy、page-lifecycle、verify-miniapp-static；js 579 行 ⚠ 超 500 |
| 帮助<br>`pages/help/help` | settings | （模板无状态分支） | 已见实际｜模拟器 cfbe567：19-help-before | FAQ 卡片文字贴左边、没有内边距；返回箭头可见 | FAQ 展开正常；帮助→反馈可达 | P2 | VIS3 | page-lifecycle、verify-miniapp-static；js 71 行 |
| 关于<br>`pages/about/about` | settings | （模板无状态分支） | 已见实际｜模拟器 cfbe567：26-about-before | 版面可读；返回箭头看不见 | AX 连点两次返回经设置回到「我的」，不能证明单步返回落点 | P2 | VIS3（返回逐页取证） | 未检出直接页级覆盖（待核实关联测试）；js 42 行 |
| 法务文档<br>`pages/legal/legal` | about, ai, assistant, feedback, home, launch 等 | 加载、失败 | 已见实际｜模拟器 cfbe567：22-legal-before（政策只读打开） | — | AX 返回回到隐私页 | — | — | self-explore-consent-items、verify-miniapp-static；js 119 行 |
| 消息通知<br>`pages/notifications/notifications` | home, launch, me, settings | 加载、失败 | 已见实际｜模拟器 cfbe567：14-notifications-before | 返回箭头看不见 | 列表是真实账号数据，含历史测试广播（没点全部已读、没删、没点条目）；是否属于存量清理范围待判 | P2 | VIS3（返回逐页取证） | verify-miniapp-static；js 139 行 |
| 扫码登录一体机<br>`pages/kiosk-login/kiosk-login` | home, print | 失败、完成、未登录 | 已见实际｜模拟器 cfbe567：31-kiosk-login-cancel-before（首页「扫码连接一体机」打开原生选图器后取消，回来是未登录态） | 从蓝色突然换成深绿奶油配色；深绿底上黑色状态栏字难读 | 没扫有效码、没确认登录、没发文件；「去登录」能到启动/登录页 | P2 | VIS3 | kiosk-login-confirm；js 348 行 |
| 发送到一体机<br>`pages/kiosk-send/kiosk-send` | kiosk-login | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | kiosk-send-receipt；js 253 行 |
| 今日提醒<br>`pages/daily-report/daily-report` | home, print | 加载、失败、空 | 已见实际｜模拟器 cfbe567：23-daily-report-before（有实际通知） | 右侧日期被微信胶囊盖住 | 返回可用 | P2 | VIS3 | 未检出直接页级覆盖（待核实关联测试）；js 129 行 |
| 意见反馈<br>`pages/feedback/feedback` | ai, assistant, help, me, privacy | 分页、加载、失败、完成 | 已见实际｜模拟器 cfbe567：20-feedback-before、20b-feedback-lower-before（空表单） | 滚动后表单进到状态栏和微信胶囊下面，页头跟着滚走 | 没填、没提交；AX 滚动可用 | P2 | VIS3 | list-load-more；js 315 行 |
