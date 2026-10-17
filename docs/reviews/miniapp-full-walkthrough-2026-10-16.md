# 小程序全量走查矩阵（2026-10-16 起）

> 格式参照 [`kiosk-full-walkthrough-2026-09-27.md`](kiosk-full-walkthrough-2026-09-27.md)。现状汇总写在 `docs/progress/current-progress.md`，这里是逐页明细，不另立账本。
> 范围：`apps/miniapp/app.json` 注册的 44 页（主包 5 + 分包 39，底部 4 个 Tab）。停放的 20 页不注册、不打包，不在本表。

## 证据口径（三类，不混算）

- **已见实际**：有人真看到过。注明是开发者工具实际模拟器截图还是用户手机，并写清源版本。
  - 开发者工具当前源码基线：`cfbe56784`（主项目 `claude/miniapp-main` 的 HEAD；不是「已发布正式版」）。
  - 候选：`689047e9f`、`8242781fa`、VIS1 的 `0205742fc`、OPS1+VIS2 的 `696437f28`、VIS3a 的 `ed73304`、VIS3b 的 `ec69af9`、VIS3c 的 `214411a`、最终候选 `6ced7f3`。
  - 手机：最终候选 `6ced7f3` 的预览，用户本人手机，只算两组指定检查（见概况）。
  - 后台 webview 的 AX 树不算可见截图。CUA 坐标点击偶发 noWindowsAvailable，不记成产品按钮坏。
- **仅代码检查**：只从源码推断入口、状态分支和测试覆盖。没人看过实际效果，不能当作通过。
- **待真机**：必须在手机上看。例如下单后的系统返回、图片预览、下载中途返回。

截图证据清单（都在 `commercial-closeout-20261016/claude-exec/evidence/`）：
- `ui-audit-2106/capture-manifest.json`：源码基线 `cfbe56784` 的运行效果，开发者工具 iPhone 12/13 (Pro)，截图 01–32 及 b 张，含每张的 SHA-256 和观察。`31a-kiosk-scan-native-picker.png` 是扫码打开的原生选图器，不算路由截图。`01-orders-before.png` 实际拍到的是首页，作废。
- `ui-audit-vis1-0205742fc/manifest.json`：VIS1 候选 `0205742fc` 的运行效果，6 张，含主项目切换前后的 SHA。
- `ui-audit-ops1-696437f28/manifest.json`：OPS1+VIS2 候选 `696437f28` 的运行效果，5 张；面试设置是用临时只读启动模式看的，不算首页跳转验收。
- `ui-audit-vis3a-ed73304f3/manifest.json`：VIS3a 候选 `ed73304`，14 张。
- `ui-audit-vis3b-ec69af9f8/manifest.json`：VIS3b 候选 `ec69af9`，9 张。
- `ui-audit-vis3c-214411ad9/manifest.json`：VIS3c 候选 `214411a`，4 张；第 4 张只做了 AX 返回验证，没单独目视。
- `ui-audit-final-6ced7f3e3/manifest.json`：最终候选 `6ced7f3`，4 张。
- `miniapp-final-6ced7f3e3-manifest.json`：最终候选的预览（11:01:46 生成，355 个跟踪文件生成前后哈希一致），以及用户手机验收记录：部分通过，「我的文档」重开。
- `ui-audit-docs-print-login-6ced7f3e3/manifest.json`：FLOW1 的复现证据，含「刷新」「重试」不发请求的 Node 沙箱复现。这一条不算网络或设备验收。

## 概况（截至 10/17 11:13，取自下面几份清单）

**收口状态**（分开写，不混算）：
- **已修复且已实屏**：开发者工具模拟器，390 宽，范围见各行。
  - 最终候选 `6ced7f3`：首页常用服务在语音卡之前；职业规划空态两句；求职材料合成一张卡（`ui-audit-final-6ced7f3e3/manifest.json`，4 张）；
  - VIS3c `214411a`：订单详情「查看到机码」主按钮和左右留白；进到机码页再返回（`ui-audit-vis3c-214411ad9/manifest.json`，4 张；返回是 AX 验证）；
  - VIS3b `ec69af9`：首页副标题两行；打印 Tab 去重，已登录不再写「登录后查看」；组包没选文件时置灰；AI 工具标题对齐；简历搭建首屏；语音简历手打题面；助手初态置灰；U 盘指引内边距（`ui-audit-vis3b-ec69af9f8/manifest.json`，9 张）；
  - VIS3a `ed73304`：
    - AI 工具、打印 Tab、意见反馈：滚动后不再穿进状态栏和胶囊，页头钉在顶部；
    - 诊断、简历上传：返回箭头可见，单次返回正确；
    - 今日提醒：日期在内容区，不压胶囊；
    - 扫码登录：现有蓝色变量，白色状态栏字（只看了未登录初态）；
  - 订单页：VIS1 的单件优先、码一行，候选 `0205742fc`、`ed73304`、`214411a` 都看过；
  - 简历优化无任务页、上传落点、面试选项：候选 `696437f28`。
- **用户手机**（最终候选 `6ced7f3` 的预览，11:09 记录，部分通过）：
  - 通过两组指定检查：
    - 首页、AI 工具、打印、诊断空态、校招自荐信填写页的布局、滑动和返回；
    - PAPER 订单详情进到机码再返回；COLOR 测试 PDF 内容完整。
  - 重开：「我的文档」列表排版、文件名、按钮样式；打印参数的操作逻辑；登录页的状态和布局；登录一次后自动恢复。见批次表 FLOW1。
  - PDF 单项通过，不等于「我的文档」整页通过。
- **已修复、待实屏**：
  - 帮助 FAQ 内边距、AI 服务记录空态跳转、登录拿不到手机号后打开短信表单：只有代码和 agy 证据；
  - 自我探索文案（VIS3b 两句，VIS3c 其余）：没截图；
  - 返回箭头：消息通知、我的简历、关于三页已改画法，候选还没截图；
  - VIS3d：RESUME_TASK 账号归属，额度用完的模板出口。要有换号、额度用完这类有效数据才能实屏；
  - VIS3e：`aria-role`。读屏效果要在手机上验。
- **未修（已登记）**：FLOW1，用户手机验收后重开，见批次表。
- **要有效数据或手机才能验**：
  - 7 个路由（选服务点、材料包确认、材料包到机码、面试作答、面试报告、简历解析、发送到一体机）；
  - 下单后的系统返回；
  - 读屏的实际效果（官方原话「部分role的设置在移动端可能无效」）；
  - 320 宽（10/17 尝试过，开发者工具重载回首页后无法操作，没有验收）；
  - 同一部手机换号；额度用完。
- 已见实际：37/44 路由有初始态或只读态实图，加上述候选实图。**只读走查不等于全功能通过，也不等于 44 页业务完成。**
- 代码层面：
  - 5 页未检出直接的页级测试覆盖（只按文件名和引用检索，可能有关联测试间接覆盖，待核实）：简历搭建、语音简历、求职材料、关于、今日提醒。VIS3a 起，vis3-shell、vis3b-pages、vis3e-pages 对其中几页加了模板或逻辑断言，但还不是完整的页级测试。
  - 10 页 js 超过 500 行，其中材料包确认 1112 行、打印确认 970 行、取件页 819 行，这三页超过 800 行，列入拆分。#1473 合入后简历优化 503 行（已评估拆分）。

## 批次

| 批 | 页面 | 内容 | 状态 |
|---|---|---|---|
| 预览修复 | 打印预览、我的文档 | 每次现取签名链接、失败说清原因、返回不留遮罩 | #1469 `689047e9f`。手机上两个 PDF 入口 PASS |
| B1 / B2 / 修订 | 取件页、订单列表、订单详情、确认页 | 按钮用语、主次、信息卡、返回路径、下单后重建页面栈 | #1470 `8242781fa`。手机查看路径两项 PASS；下单后系统返回待真机 |
| VIS1 | 订单列表、诊断报告 | 首屏空卡、到机码折行、单件「加载更多」、导出只在完成态、按钮越界根因 | #1472 `0205742fc`。候选实屏局部通过（Codex，开发者工具实际模拟器，用户本人登录）。CI：smoke 红在一体机 `kiosk-session-warning.spec.ts:142`，和 #1469 是同一条用例，22:18 交 Grok 归类 |
| OPS1 + VIS2 | 简历优化、面试入口 | 入口死路改走「我的简历 / 上传新简历」；失败态加「选择其他简历」；上传落点改为选文件页；时长选项写清、选项块居中 | #1473 `696437f28`。第一版方案 agy 判需修改已撤；冷审阻断（上传落到解析页报错）已修；agy 重核：可以出候选。CI 全绿。实屏局部通过：无任务页两个入口、上传落点、面试选项居中与时长题数、点选高亮。不算通过：上传页返回图标看不见、首页到面试的跳转、空态开始提示 |
| VIS3（已拆成 3a–3e，见下面各行） | 优先（用户 10/16 晚指定，已有实图证实）：滚动进状态栏和胶囊（AI 工具、意见反馈、打印 Tab）；部分页返回箭头稳定看不见并补无障碍返回名称；今日提醒日期被胶囊盖住；帮助卡片内边距；首页和 AI 工具入口层级；语音简历文字模式。其次：订单详情主按钮贴边、组包「下一步」、AI 服务记录空态、助手初态、职业规划孤字、打印 Tab 文案、U盘指引标签、扫码登录配色、自我探索用语 | 按现有组件和全局样式找共享根因，不逐页打补丁；不删已验证功能 | 已拆成 VIS3a–VIS3e 实现，见下面各行 |
| VIS3a | 38 个有返回键的页、21 页页头、今日提醒、扫码登录 | 页头钉顶；返回键无障碍并换画法；日期移出胶囊区；扫码登录回到现有配色 | #1474 `ed73304`。agy 方案两轮、实现复核：可以出候选。实屏 14 张（开发者工具；320 宽未验；手机未验） |
| VIS3b | 打印 Tab、AI 工具、首页、帮助、U 盘、订单详情、组包、AI 服务记录、助手、语音简历、自我探索、简历搭建、登录 | 页面层级、对齐、内边距、空态出口、置灰、手打题面、首屏顺序；登录拿不到手机号后打开短信表单 | #1475 `ec69af9`（本机 469/469）；agy 实现通过；实屏 9 张（390 宽；帮助、空态跳转、订单详情边距、登录兜底没截图） |
| VIS3c | 订单详情、自我探索 | 待到机详情给「查看到机码」主操作（复用取件页路由，码不进 URL）；其余「服务端」提示 | #1476 `214411a`。agy 方案、实现都通过。实屏 4 张：详情主次按钮和左右留白，进到机码页再返回（返回是 AX 验证）；自我探索文案没截图 |
| VIS3d（冻结前最后一批） | 诊断、职业规划、岗位匹配、自我探索、解析；简历优化 | RESUME_TASK 账号归属（复用 ownerId）；额度用完或 AI 不可用时给「按模板手动填写」（现有 resume-build）。原先「另起一批」的 RESUME_TASK 并入这一批 | #1477 `bf24d51`。agy 方案、实现都通过；本机 vis3d-logic 6 条，加 page-lifecycle 的 RP-OWN。换号、额度用完要有效数据，没实屏 |
| VIS3e | 26 个注册页、首页、职业规划、求职材料 | `role=` 改成 `aria-role=`（166 处，取值守恒）；语音卡挪到常用服务之后；空态说明拆成两句；字段合进一张卡 | #1478 `6ced7f3`，**最终候选，已冻结**。agy：可以出候选。实屏 4 张；用户手机两组指定检查通过 |
| FLOW1（11:09 后重开） | 我的文档、打印参数、原文预览、选终端、确认；登录页；会话持久化 | 步骤文案；终端能力和颜色、单双面的先后；返回保留已选；主次按钮；文档列表的文件名布局；「刷新」「重试」不发请求（点击事件被当成翻页参数）；登录页的布局和各种状态，登录后按 returnTo 回到原处；登录一次后自动恢复。复用现有功能、auth、短信和 returnTo，不新增入口和认证机制 | FLOW1a #1479 `05d26c1` 冻结：agy 方案、实现都通过（可以出候选）；15 条门禁全过；反向检查 17 条中 16 条转红。实屏被会话 30 分钟过期挡在登录页，文档和参数两页没验到，不算通过。FLOW1b（会话、登录页）方案交 agy 中 |

## 跨页待核

1. **返回箭头可见性**（不假设同一个根因，不先改全局图标）：
   - 稳定截图里看得见：设置、帮助、隐私、AI 服务记录、岗位匹配、自我探索、U盘指引。
   - 看不见：诊断（候选 02）、订单详情（候选 10）、简历上传（13）、消息通知（14）、我的简历（24b，稳定后仍看不见）、关于（26）。
   - 先前缺失的截图有的可能是首帧，要取稳定后的截图复看。
   - 代码：54 页共用 `ficon i-right nav-back-ic`。`app.wxss` 里 `.navbar .nav-back` 是 48px，`.nav-back-ic` 旋转 180°，图标是 `.i-right` 的 mask 图。扫码登录、发送到一体机两页用别的写法。
   - 先逐页取稳定截图和渲染尺寸，再定根因。
   - 现状（11:13）：VIS3a 换成边框画法。候选实图里看得见的：诊断、简历上传、订单详情（VIS3c 02）、职业规划、求职材料（最终候选 02、03）。消息通知、我的简历、关于还没截图。根因没有定位，不写根因。
2. **返回按钮没有无障碍名称**：多数是没有名称的空 view，读屏和 AX 工具都找不到，坐标工具又反复 noWindowsAvailable。
   - 微信官方文档（aria-component，基础库 2.7.1 起）规定角色属性叫 `aria-role`。仓库里 `role=` 有 248 处、`aria-role=` 只有 2 处。
   - 56 个返回键里 39 个没有 `aria-label`，17 个写的是 `role="button"`。
   - VIS3 统一成 `aria-role="button" aria-label="返回"`，先报预算。读屏的实际效果要在手机上验。
   - 现状：VIS3a 改了 38 个返回键；VIS3e 把注册页其余 166 处 `role=` 改成 `aria-role=`，注册页里不再有单独的 `role=`。读屏效果仍待手机验。
3. **状态栏与胶囊**：
   - 滚动后内容进到状态栏和胶囊下面，页头跟着滚走：AI 工具（04b）、意见反馈（20b）、打印 Tab（16b）。
   - 今日提醒右侧日期被胶囊盖住（23）。
   - 根因待核。
   - 现状：VIS3a 让页头钉在顶部，日期移进内容区。AI 工具、打印 Tab、意见反馈、今日提醒都已实屏。
4. **RESUME_TASK 没有账号归属**：诊断页「查看上一次的诊断（文件名）」，以及职业规划、岗位匹配无任务时都读它。服务端按归属拒绝（`AI_TASK_NOT_FOUND`）；残留风险是同一部手机换号后能看到上一位的文件名。**VIS3d #1477 已修复（代码和测试）；换号场景要有效数据才能实屏。**
5. **AI 额度用完**：服务端提示「可以先按模板手动填写」，但优化页失败态没有去模板的入口。**VIS3d 已修复：失败态给「按模板手动填写」，去「从零建一份简历」。额度用完要有效数据才能实屏。**
6. **配色突变**：扫码登录一体机（31）从蓝色突然换成深绿奶油，深绿底上黑色状态栏字难读。**VIS3a 已修复、已实屏（只看了未登录初态）。**
7. **工具限制，不算产品缺陷**：
   - CUA 坐标点击偶发 noWindowsAvailable；
   - 底栏「打印」坐标点击几次不响应，改用文本节点能进入。

## 逐页矩阵

| 页面 | 入口（代码） | 模板状态分支（代码） | 证据 | 视觉问题 | 操作问题 | 严重度 | 修复 | 测试；规模 |
|---|---|---|---|---|---|---|---|---|
| 首页<br>`pages/home/home` | 底部 Tab；TabBar, about, ai-records, assistant, career-plan, daily-report 等 | （模板无状态分支） | 已见实际｜模拟器 cfbe567：03-home-top-before（已登录、有一笔待到机）<br>已见实际｜模拟器 候选 ec69af9：01-home-pickup（用户本人登录：待取件终端名和到期时间完整，副标题换行不再截断）<br>已见实际｜模拟器 最终候选 6ced7f3：01-home（常用服务四项在语音卡之前，入口都在；这次没出现待取件卡）<br>已见实际｜手机 6ced7f3：布局、滑动和返回通过（用户原话「布局清楚，滑动与返回正常」） | 入口层级密集；待取件副标题被截断 | — | P2 | 副标题两行：VIS3b #1475 `ec69af9` 已修复、已实屏（01）。入口层级：VIS3e 只把语音卡挪到常用服务之后，已实屏（最终候选 01），手机通过 | page-lifecycle、print-flow-ux、verify-miniapp-static 等；js 170 行 |
| 启动/登录<br>`pages/launch/launch` | ai-records, career-plan, daily-report, documents, feedback, job-fit 等 | 锁定 | 已见实际｜模拟器 cfbe567：32-launch-before（从扫码登录一体机「去登录」进入） | 版面完整 | 没勾协议前登录按钮不可用；没勾协议、没提交登录。<br>10/17 用户实测：微信一键登录拿不到手机号时，开发者工具弹出微信自己的「获取手机号失败 / Error: 用户绑定的手机需要进行验证，请在客户端完成短信验证步骤」（小程序代码里没有这两句），之后页面只弹两秒提示，不打开短信表单 | P2 | 拿不到手机号后直接打开现有短信验证码表单：VIS3b 已修复；没截图，只有代码和 agy 证据。微信自己的报错框页面改不了，也不绕过。登录页的布局和各种状态、登录后按 returnTo 回到原处、登录一次后自动恢复：FLOW1 重开 | ai-access、page-lifecycle、session-generation 等；js 270 行 |
| AI 工具（Tab）<br>`pages/ai/ai` | 底部 Tab；TabBar, assistant, daily-report, help, home | （模板无状态分支） | 已见实际｜模拟器 cfbe567：04-ai-before、04b-ai-lower-before<br>已见实际｜模拟器 候选 ed73304：01-ai-top、02-ai-scrolled（往下翻页后页头钉住，状态栏和胶囊不再被内容盖住）<br>已见实际｜模拟器 候选 ec69af9：04-ai-alignment（分组标题和卡片左边对齐）<br>已见实际｜手机 6ced7f3：布局、滑动和返回通过 | 分组标题与说明贴左、没和卡片对齐；顶部说明和入口密集；滚动后内容跑到状态栏和微信胶囊下面（截图所见，根因待核） | — | P2 | 滚穿顶：VIS3a 已修复、已实屏（02）。分组标题对齐：VIS3b 已修复、已实屏（04） | verify-miniapp-static、verify-package-layout；js 140 行 |
| 打印（Tab）<br>`pages/print/print` | 底部 Tab；TabBar, assistant, daily-report, home, resume-diagnose | （模板无状态分支） | 已见实际｜模拟器 cfbe567：16-print-before（Codex 当时记为已登录）、16b-print-lower-before（下半屏；**运行时已是未登录态，不能算已登录截图**）<br>已见实际｜模拟器 候选 ed73304：07-print-top、08-print-scrolled（页头钉住）<br>已见实际｜模拟器 候选 ec69af9：02-print-tab（卡片流程小字已去掉；已登录时不再写「登录后查看」）<br>已见实际｜手机 6ced7f3：布局、滑动和返回通过 | 初屏引导、步骤、大入口卡层级重复；下滚后内容穿进状态栏和微信胶囊下面 | 「今日提醒」的「登录后查看」在 `print.js:25` 写死（代码），已登录时也这么写，待已登录运行复测；底栏坐标点击几次不响应，改用文本节点能进入（工具限制） | P2 | 滚穿顶：VIS3a 已修复、已实屏（08）。层级重复与写死的「登录后查看」：VIS3b 已修复、已实屏（02） | free-pilot-copy、verify-miniapp-static、verify-package-layout；js 60 行 |
| 我的（Tab）<br>`pages/me/me` | 底部 Tab；TabBar, assistant, daily-report, feedback, home | 失败、未登录 | 已见实际｜模拟器 候选 0205742fc：09-me-current（未登录态）<br>已见实际｜模拟器 cfbe567：15-me-auth-before（已登录：0 简历、17 文档、9 订单） | — | — | — | — | me-stats、print-flow-ux、verify-miniapp-static 等；js 171 行 |
| AI 助手<br>`pages/assistant/assistant` | ai, home | 加载、锁定 | 已见实际｜模拟器 cfbe567：11-assistant-before（问候态）<br>已见实际｜模拟器 候选 ec69af9：07-assistant-initial（初态「保存本次要点」外观和无障碍都是不可用；没发问题；返回箭头可见） | 只有问候就显著显示「保存本次要点」大按钮 | 待核：只有问候时该不该显示、能不能点（未点，未发 AI 请求） | P2 | 无对话时置灰：VIS3b 已修复、已实屏（07） | page-lifecycle；js 330 行 |
| 材料包·组包<br>`pages/package-create/package-create` | orders, package-confirm, print, store-select | 分页、加载、失败、完成、未登录 | 已见实际｜模拟器 cfbe567：17-package-create-before、17b-package-empty-next-before（一份没选）<br>已见实际｜模拟器 候选 ec69af9：03-package-empty-selection（一份没选时「选择服务点」外观和无障碍都是不可用；没选文件、没建单） | 一份没选时「下一步」是蓝色可点的样子 | 点了提示「请先选择文件」、留在本页、没建单：可用性待优化，不是漏校验 | P2 | 没选文件时置灰：VIS3b 已修复、已实屏（03） | free-pilot-copy、package-order-idempotency、page-lifecycle 等；js 553 行 ⚠ 超 500 |
| 材料包·选服务点<br>`pages/store-select/store-select` | package-confirm, package-create | 加载、失败、空 | 仅代码检查 | 待截图 | 待走查 | — | — | package-order-idempotency、page-lifecycle、verify-miniapp-static 等；js 186 行 |
| 材料包·确认<br>`pages/package-confirm/package-confirm` | store-select | 加载、失败、完成、未登录 | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、package-order-idempotency、page-lifecycle 等；js 1112 行 ⚠ 超 800 |
| 材料包·到机码<br>`pages/package-code/package-code` | home, orders, package-confirm | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | free-pilot-copy、home-pickup-summary、package-order-idempotency 等；js 457 行 |
| 打印·上传参数<br>`pages/print-upload/print-upload` | assistant, career-plan, documents, interview-qa, interview-result, job-fit 等 | 加载、失败、完成 | 已见实际｜手机 689047e9f：「查看原文」入口；03439f5 下单时走过 | 待截图 | 用户手机（6ced7f3）：「进入文件打印参数这里面，操作逻辑混乱，都要整改修复」。代码发现（待实屏）：份数和默认的黑白单面在前，选终端后又要再选一次颜色和单双面；步骤条的「到机核验」和手机上的阶段对不上；返回后选择是否保留待核 | P1 | FLOW1 重开 | free-pilot-copy、page-lifecycle、print-flow-ux 等；js 302 行 |
| 打印·选终端<br>`pages/print-store/print-store` | print-upload | 加载、失败、完成、空 | 已见实际｜手机 03439f5（旧源）：COLOR / DUPLEX / OFFLINE 下单时走过 | 待截图 | 待走查。终端能力和颜色、单双面的先后属于 FLOW1 | — | FLOW1 范围 | free-pilot-copy、page-lifecycle、print-capabilities 等；js 289 行 |
| 打印·确认<br>`pages/print-pay/print-pay` | print-store | 加载、失败、未登录、锁定 | 已见实际｜手机 03439f5（旧源）：同上 | 待截图 | 待走查。步骤文案、主次按钮属于 FLOW1；不提交真实订单 | — | FLOW1 范围 | free-pilot-copy、page-lifecycle、price-confirmation 等；js 970 行 ⚠ 超 800 |
| 打印·到机码/取件<br>`pages/print-pickup/print-pickup` | home, orders, print-pay | 加载、失败、完成、未登录 | 已见实际｜手机 03439f5（旧源）：同上；8242781fa 查看路径（用户未逐页记录）<br>已见实际｜模拟器 候选 214411a：03-pickup-from-detail（从订单详情进，同一笔 PAPER 单；没核销、没换码）<br>已见实际｜手机 6ced7f3：从订单详情进到机码再返回，通过 | 只看了从订单详情进来这一种 | 从订单详情进来，再返回：通过 | — | — | free-pilot-copy、home-pickup-summary、page-lifecycle 等；js 819 行 ⚠ 超 800 |
| 简历搭建<br>`pages/resume-build/resume-build` | ai, ai-records, resume-voice | 加载、失败、完成、未登录 | 已见实际｜模拟器 cfbe567：05-resume-build-before（空表单）<br>已见实际｜模拟器 候选 ec69af9：05-resume-build-first（基本信息在语音入口之前；空表单，没填） | 语音替代入口和大段说明先占首屏，基本字段靠下 | — | P2 | 首屏顺序：VIS3b 已修复、已实屏（05） | 未检出直接页级覆盖（待核实关联测试）；js 555 行 ⚠ 超 500 |
| 语音简历<br>`pages/resume-voice/resume-voice` | ai, home, resume-build | 失败、完成 | 已见实际｜模拟器 cfbe567：07、07b（未勾选录音 → 用手打进入第一题）<br>已见实际｜模拟器 候选 ec69af9：06-voice-text-mode（不同意录音、选手打：题面写「请填写你的姓名」，不再写「说出」；没填内容） | 文字模式题面仍写「请说出你的姓名」「转成文字后」 | 文字兜底入口本身可用（已观察） | P2 | 手打题面：VIS3b 已修复、已实屏（06） | 未检出直接页级覆盖（待核实关联测试）；js 387 行 |
| 简历上传<br>`pages/resume-upload/resume-upload` | assistant, career-plan, job-fit, resume-diagnose, resume-parse, resumes 等 | （模板无状态分支） | 已见实际｜模拟器 cfbe567：13-resume-upload-before<br>已见实际｜模拟器 候选 696437f28：03-upload-landing（选文件页）<br>已见实际｜模拟器 候选 ed73304：05-upload-back-arrow（返回箭头可见，单次返回到简历优化；Codex 初看缩略图误判，放大原图后已更正） | 基线返回箭头看不见；候选里可见 | 返回可用（候选，AX 单次返回） | — | VIS3a #1474 `ed73304` 已修复、已实屏（05） | verify-miniapp-static；#1473 起 ai-entry-fixes 也测这一页的落点；js 128 行 |
| AI 诊断报告<br>`pages/resume-diagnose/resume-diagnose` | ai, ai-records, assistant, home, resume-parse, resumes | 加载、失败、完成、禁用、空 | 已见实际｜模拟器 cfbe567：02-diagnose-before（空态）<br>已见实际｜模拟器 候选 0205742fc：02-diagnose-after（空态）<br>已见实际｜模拟器 候选 ed73304：03-diagnose-back-arrow（返回箭头可见，单次返回到首页）<br>已见实际｜手机 6ced7f3：空态的布局、滑动和返回通过 | 改前：无报告却有整块禁用导出卡、并排按钮越屏、空态与主按钮之间大片空白。候选：已消失；返回箭头在这张里看不明显（根因与候选关系未确认） | 改前：空态主操作离说明太远。候选：主按钮贴近说明 | P1 | VIS1 #1472 `0205742fc`：候选实屏局部通过。返回箭头：VIS3a `ed73304` 已修复、已实屏（03）。RESUME_TASK 账号归属：VIS3d 已修复（代码和测试，换号场景没实屏） | ai-records-qa、free-pilot-copy、page-lifecycle 等，#1472 加 vis-layout；js 343 行 |
| 简历优化<br>`pages/resume-optimize/resume-optimize` | ai, ai-records, assistant, home, job-fit, resume-diagnose 等 | 加载、失败、完成、禁用 | 已见实际｜模拟器 cfbe567：06-resume-optimize-before（从 AI 工具正常进入）<br>已见实际｜模拟器 候选 ed73304：04-optimize-empty（无任务页两个入口，返回箭头可见） | — | 改前：无 taskId 时只有「未指定优化任务／请从简历诊断页发起」和「返回」，入口是死路；失败态「重新上传简历」跳解析页落到报错 | P1 | OPS1 #1473 `696437f`：只给「从我的简历选择 / 上传新简历」，不读缓存；失败态加「选择其他简历」；上传落点改为选文件页。agy 重核可以出候选；无任务页已实屏（ed73304 的 04）。额度用完或 AI 不可用时给「按模板手动填写」：VIS3d 已修复（代码和测试，没实屏） | free-pilot-copy、verify-miniapp-static；#1473 加 ai-entry-fixes（13 条）；js 498 行（#1473 后 503 行，已评估拆分） |
| 模拟面试·设置<br>`pages/interview-entry/interview-entry` | ai, assistant, home, interview-result, job-fit | （模板无状态分支） | 已见实际｜模拟器 cfbe567：08-interview-entry-before（空表单） | 选择控件文字贴顶、下半块空白；「练习时长」标签与按题数写的选项对不上 | — | P2 | VIS2 #1473：选项写时长和题数、选项块纵向居中；全页同类控件只有这一处没居中 | page-lifecycle；#1473 加 ai-entry-fixes；js 79 行（#1473 后 80 行） |
| 模拟面试·作答<br>`pages/interview-qa/interview-qa` | interview-entry | 加载、失败 | 仅代码检查 | 待截图 | 待走查 | — | — | page-lifecycle；js 202 行 |
| 模拟面试·报告<br>`pages/interview-result/interview-result` | ai-records, interview-qa | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | interview-result-compliance、page-lifecycle；js 121 行 |
| 职业规划<br>`pages/career-plan/career-plan` | ai, ai-records, assistant, home | 加载、失败、完成 | 已见实际｜模拟器 cfbe567：12-career-plan-before（无简历空态）<br>已见实际｜模拟器 最终候选 6ced7f3：02-career-empty（空态说明两句，返回首页成功） | 说明折行后剩一个孤字 | 上传入口能到简历上传页；无任务时读没有归属的 RESUME_TASK（代码） | P3 | 孤字：VIS3e 已修复、已实屏（最终候选 02）。RESUME_TASK：VIS3d 已修复（代码和测试，换号场景没实屏） | self-explore-consent-items、verify-miniapp-static；js 250 行 |
| 自我探索<br>`pages/self-explore/self-explore` | ai, ai-records, career-plan | 加载、失败、完成、锁定 | 已见实际｜模拟器 cfbe567：29-self-explore-before（只看介绍和同意说明） | 说明很长；露出「E3」「服务端拒绝」等实现用语；返回箭头可见 | 没同意、没作答、没发 AI 请求；AX 返回回到 AI 工具。以后精简必须保留同意内容 | P2 | 同意区和底部说明两句：VIS3b 已修复；模板其余 5 处、脚本提示 4 处：VIS3c 已修复，同意内容一字不动。都没截图。匿名令牌只用本人的：VIS3d 已修复（代码和测试） | self-explore-consent-items、verify-miniapp-static；js 780 行 ⚠ 超 500 |
| 岗位匹配参考<br>`pages/job-fit/job-fit` | ai, ai-records, assistant | 加载、失败、完成 | 已见实际｜模拟器 cfbe567：28-job-fit-before（无简历空态） | 返回箭头可见 | 上传入口可见；返回 AI 工具可用；无任务时读没有归属的 RESUME_TASK（代码） | — | RESUME_TASK：VIS3d 已修复（代码和测试，换号场景没实屏） | verify-miniapp-static、verify-review-scope；js 354 行 |
| 打印预览<br>`pages/print-preview/print-preview` | print-upload | 加载 | 已见实际｜手机 689047e9f：「打开原文查看」PDF 完整、返回无残留遮罩 | 待截图 | 待走查。属于 FLOW1 范围 | — | FLOW1 范围 | file-preview、free-pilot-copy、page-lifecycle 等；js 181 行 |
| U盘打印指引<br>`pages/usb-import/usb-import` | print | （模板无状态分支） | 已见实际｜模拟器 cfbe567：30-usb-import-before<br>已见实际｜模拟器 候选 ec69af9：08-usb-guide、09-usb-guide-bottom（格式卡片有内边距；底部说明可读，标题钉住；单次返回到打印 Tab） | 格式标签贴在卡片左边；返回箭头可见 | 没打印、没导入 | P3 | 格式标签内边距：VIS3b 已修复、已实屏（09） | page-lifecycle；js 28 行 |
| 简历解析<br>`pages/resume-parse/resume-parse` | resume-diagnose, resume-optimize, resume-upload | 失败、完成、锁定 | 仅代码检查 | 待截图 | 不带 fileId 进入停在「缺少待解析的简历文件」（代码；#1473 起优化页不再直接跳这里） | — | — | page-lifecycle、verify-miniapp-static；#1473 起 ai-entry-fixes 用它做反例；js 756 行 ⚠ 超 500 |
| 我的简历<br>`pages/resumes/resumes` | me | 分页、加载、失败、未登录 | 已见实际｜模拟器 cfbe567：24-resumes-before、24b-resumes-settled-before（0 份空态） | 稳定后返回箭头仍看不见 | 点左上区域能回「我的」；空态主按钮合理 | P2 | 返回箭头：VIS3a `ed73304` 已改画法（代码），候选还没截图，不记通过 | list-load-more、verify-miniapp-static；#1473 起 ai-entry-fixes 也测这一页的落点；js 183 行 |
| 我的文档<br>`pages/documents/documents` | ai, home, launch, me, order-detail, orders 等 | 分页、加载、失败、锁定 | 已见实际｜手机 689047e9f / 8242781fa：预览 PDF 完整、返回正常<br>已见实际｜手机 6ced7f3：COLOR 测试 PDF 内容完整（只算这一项） | 用户手机（6ced7f3）：「我的文档里面还是有问题，就是不是全部，好了一部分」，列表排版、文件名或按钮样式不顺 | 代码确认、沙箱复现（Claude、Codex 各一次）：「刷新」和失败「重试」都绑 `loadDocuments`，点击事件被当成翻页参数；没有下一页时不发请求，有下一页时追加下一页而不是刷新。代码发现（待实屏）：点整行进打印，预览藏在「⋯」里；几个打印入口叫法不一 | P1 | FLOW1 重开 | file-preview、page-lifecycle、print-flow-ux 等；js 468 行 |
| 求职材料<br>`pages/job-materials/job-materials` | ai | 加载、失败、空 | 已见实际｜模拟器 cfbe567：27-job-materials-before（模板目录）、27b-job-materials-form-before（校园求职信空表单）<br>已见实际｜模拟器 最终候选 6ced7f3：03-material-form、04-material-form-bottom（字段合在一张卡里；底部说明和固定按钮没有横向溢出；返回 AI 工具成功）<br>已见实际｜手机 6ced7f3：校招自荐信填写页的布局、滑动和返回通过 | 表单每个字段一张独立大卡片 | 空表单时「生成」不可用；没填、没生成；坐标返回没确认（工具限制） | P3 | VIS3e 已修复、已实屏（最终候选 03、04），手机通过 | 未检出直接页级覆盖（待核实关联测试）；js 145 行 |
| 打印订单<br>`pages/orders/orders` | home, me, notifications, order-detail, package-code, package-confirm 等 | 分页、加载、失败、完成、未登录、空 | 已见实际｜模拟器 cfbe567：01-orders-actual-before<br>已见实际｜手机 8242781fa：查看已完成 COLOR / DUPLEX 与待到机 PAPER 单（只看不下单）<br>已见实际｜模拟器 候选 0205742fc：01-orders-after、01b-orders-pending-after、01c-orders-empty-filter-after（用户本人登录）<br>已见实际｜模拟器 候选 ed73304：13-orders-auth-top（用户本人登录：待到机 PAPER 加已过期单；单件在前，到机码一行，提示在下，长文件名在卡片内换行）。320 宽没有验收<br>已见实际｜模拟器 候选 214411a：01-orders-pending（单件在前，PAPER 待到机，码一行） | 改前：材料包 0 笔大空卡占首屏；到机码和标签折行；字小、卡里套卡。候选：单件在前、码一行、材料包空态一行 | 改前：真实订单被挤到下面。候选：「待取件」筛选一笔 PAPER 加紧凑空行；「打印中」筛选零单件、提示切到全部 | P1 | VIS1 #1472 `0205742fc`：候选实屏局部通过 | free-pilot-copy、page-lifecycle、print-flow-ux 等，#1472 加 vis-layout；js 539 行 ⚠ 超 500 |
| 订单详情<br>`pages/order-detail/order-detail` | orders | 加载、失败 | 已见实际｜模拟器 候选 0205742fc：10-order-detail-current（只读打开）<br>已见实际｜模拟器 候选 ed73304：14-order-detail-auth（用户本人登录的真实待到机 PAPER 单，字段和码都在）<br>已见实际｜模拟器 候选 214411a：02-order-detail-pending（「查看到机码」主按钮，「去我的文档打印」次按钮，左右留白，返回箭头可见）、04-detail-after-back（AX：从取件页返回一次回到详情，再返回一次回到订单列表）<br>已见实际｜手机 6ced7f3：详情进到机码再返回，通过 | 主按钮贴到屏幕左右边缘（候选 10、14） | 点左上返回区能回到订单列表。待到机的详情只有「去我的文档打印」一个主按钮，没有直接看到机码或二维码的主操作（实图 14） | P2 | 按钮贴边：VIS3b 已修复、已实屏（VIS3c 02）。查看到机码：VIS3c #1476 `214411a` 已修复、已实屏（02–04），手机通过 | free-pilot-copy、order-detail-refresh、page-lifecycle 等；js 593 行 ⚠ 超 500 |
| AI 服务记录<br>`pages/ai-records/ai-records` | ai, assistant, me, notifications, resume-parse | 加载、失败、未登录 | 已见实际｜模拟器 cfbe567：25-ai-records-before（空态） | 返回箭头可见 | 空态没有直接去使用的入口；返回可用 | P2 | 空态出口：VIS3b 已修复；空态跳转没截图，只有代码和 agy 证据 | ai-records-qa、page-lifecycle、verify-miniapp-static；js 384 行 |
| 设置<br>`pages/settings/settings` | me | 未登录 | 已见实际｜模拟器 cfbe567：18-settings-before | 稳定渲染后返回箭头可见 | — | — | — | verify-miniapp-static；js 61 行 |
| 隐私与数据<br>`pages/privacy/privacy` | feedback, settings | 加载、失败、未登录、空 | 已见实际｜模拟器 cfbe567：21-privacy-before | 返回箭头可见 | 反馈→隐私→法务可达；坐标返回 noWindowsAvailable（工具限制），返回没确认 | — | — | free-pilot-copy、page-lifecycle、verify-miniapp-static；js 579 行 ⚠ 超 500 |
| 帮助<br>`pages/help/help` | settings | （模板无状态分支） | 已见实际｜模拟器 cfbe567：19-help-before | FAQ 卡片文字贴左边、没有内边距；返回箭头可见 | FAQ 展开正常；帮助→反馈可达 | P2 | FAQ 内边距：VIS3b 已修复；这批没截图，只有代码和 agy 证据 | page-lifecycle、verify-miniapp-static；js 71 行 |
| 关于<br>`pages/about/about` | settings | （模板无状态分支） | 已见实际｜模拟器 cfbe567：26-about-before | 版面可读；返回箭头看不见 | AX 连点两次返回经设置回到「我的」，不能证明单步返回落点 | P2 | 返回箭头：VIS3a `ed73304` 已改画法（代码），候选还没截图，不记通过 | 未检出直接页级覆盖（待核实关联测试）；js 42 行 |
| 法务文档<br>`pages/legal/legal` | about, ai, assistant, feedback, home, launch 等 | 加载、失败 | 已见实际｜模拟器 cfbe567：22-legal-before（政策只读打开） | — | AX 返回回到隐私页 | — | — | self-explore-consent-items、verify-miniapp-static；js 119 行 |
| 消息通知<br>`pages/notifications/notifications` | home, launch, me, settings | 加载、失败 | 已见实际｜模拟器 cfbe567：14-notifications-before | 返回箭头看不见 | 列表是真实账号数据，含历史测试广播（没点全部已读、没删、没点条目）；是否属于存量清理范围待判 | P2 | 返回箭头：VIS3a `ed73304` 已改画法（代码），候选还没截图，不记通过 | verify-miniapp-static；js 139 行 |
| 扫码登录一体机<br>`pages/kiosk-login/kiosk-login` | home, print | 失败、完成、未登录 | 已见实际｜模拟器 cfbe567：31-kiosk-login-cancel-before（首页「扫码连接一体机」打开原生选图器后取消，回来是未登录态）<br>已见实际｜模拟器 候选 ed73304：09-kiosk-login-unauth（未登录初态：现有蓝色变量，白色状态栏字读得清，返回可见） | 从蓝色突然换成深绿奶油配色；深绿底上黑色状态栏字难读 | 没扫有效码、没确认登录、没发文件；「去登录」能到启动/登录页 | P2 | 配色与状态栏：VIS3a 已修复、已实屏（09，只是未登录初态；有效扫码、确认登录、长内容滚动没测） | kiosk-login-confirm；js 348 行 |
| 发送到一体机<br>`pages/kiosk-send/kiosk-send` | kiosk-login | 加载、失败、完成 | 仅代码检查 | 待截图 | 待走查 | — | — | kiosk-send-receipt；js 253 行 |
| 今日提醒<br>`pages/daily-report/daily-report` | home, print | 加载、失败、空 | 已见实际｜模拟器 cfbe567：23-daily-report-before（有实际通知）<br>已见实际｜模拟器 候选 ed73304：06-daily-report-unauth（未登录：返回可见可用，没有日期）、12-daily-report-auth（用户本人登录：2026-10-17 日期在内容区、标题居中下方，不压胶囊；单次返回到打印 Tab） | 基线日期被胶囊盖住；候选日期在内容区 | 返回可用 | — | VIS3a 已修复、已实屏（12） | 未检出直接页级覆盖（待核实关联测试）；js 129 行 |
| 意见反馈<br>`pages/feedback/feedback` | ai, assistant, help, me, privacy | 分页、加载、失败、完成 | 已见实际｜模拟器 cfbe567：20-feedback-before、20b-feedback-lower-before（空表单）<br>已见实际｜模拟器 候选 ed73304：10-feedback-top、11-feedback-scrolled（用户本人登录：往下翻页后标题和返回钉住，单次返回到「我的」） | 滚动后表单进到状态栏和微信胶囊下面，页头跟着滚走 | 没填、没提交；AX 滚动可用 | P2 | 滚穿顶：VIS3a 已修复、已实屏（11） | list-load-more；js 315 行 |
