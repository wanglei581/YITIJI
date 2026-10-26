# 青序流光 · 触屏版（一体机前台，2026-10-25）

> **产品负责人拍板（2026-10-25 19:15）：「稿子可以，解冻 2.0，按对照表先改首页、打印、简历三条主路」。**
> - 首页、打印、简历三条主路（路由见下面「本次改程序的范围」）的运行页**以本目录为准**，不再对齐 2.0 稿。2.0 稿目录里对应的那几张原样保留、不改，只作历史参照。
> - 其余页面**照旧以 2.0 稿**（`docs/design/kiosk-redesign-2026-08-v2/`）为准、照旧冻结。本目录里其余各屏是同一方向的稿，产品负责人另行拍板之前不据此改程序。
> - 本目录是定稿快照：改稿先报产品负责人；运行页和稿不一致时改运行页。稿文件由冻结门禁 `verify:kiosk-touch-frozen` 守着（见文末「冻结」）。
> - **2026-10-26 补稿已定稿**：按产品负责人 10/25「改程序前先补稿」，把运行页有、稿上没画的状态与功能补进稿、字按代码事实改，他看过补稿后的私有页并定了三件事（见下面「补稿」）。
> - 配色、字体沿用 2.0；这一版只减密度（一屏一问、可点的东西放到够得着的地方、空间给「带走什么」）并加动效。

## 怎么看

浏览器打开 `index.html`（字体从 Google Fonts 加载，打不开时退回系统字体）。

- 地址后加 `#屏编号` 直接打开某一屏，例如 `index.html#preview`；加 `?shot=1` 是纯 1080×1920 舞台，截图对照用这个。
- `?printer=down`、`?ai=down`、`?login=1` 切到打印机离线、小青不可用、已登录；`?reduced=1` 减弱动效。
- 右侧说明栏：每屏「做什么 / 动效 / 必须保留」；「设计规则」是规则全文（`app.js` 的 `RULES`）；「旧页 → 新页对照表」（或地址加 `?map=1`）是 110 条路由的对照。

## 文件

| 文件 | 内容 |
|---|---|
| `index.html` | 样式（CSS 令牌、组件样式、动效）与页面骨架 |
| `ui.js` | 组件：顶部意图带、底部按区（返回 / 问小青 / 主按钮）、底部导航、大选项卡、磁贴、进度路径线、「带走什么」小样插画 |
| `screens.js` | 第一批 44 屏：五条主路的完整流程与公共页 |
| `screens2.js` | 第二批 41 屏：公共 6、我的 13、改简历 12、练面试 2、打印扫描 3、受控与扩展 5 |
| `screens3.js` | 10/26 补稿：「状态样式板」7 屏（见下面「补稿」） |
| `screens4.js` | 10/26 补稿：简历新屏 4 张——诊断方向、更多条件、编辑、导出与打印（分组仍是「改简历」） |
| `FROZEN.json` | 冻结清单：上面各稿文件的 sha256，门禁 `verify:kiosk-touch-frozen` 按它比对 |
| `data.js` | 示例数据 |
| `map.js` | 旧页面 → 新页面对照（底稿是 Codex 10/24 的 109 条路由台账加 1 条兜底路由，去向、改法、现状问题由 Claude 填写）。它是生成产物，仓库里是定稿快照，不要手改 |
| `app.js` | 说明栏、状态开关、设计规则全文 |

仓库版没带设计过程里对照用的线上截图（`live-shots.js`），对照表里「线上现在」那一格因此不显示，其余不受影响。

## 本次改程序的范围（10/25 拍板的三条主路）

运行页源文件以 `main@0b4b5770b` 为准，开工时对 `origin/main` 重核。

| 路由 | 运行页源文件 | 触屏稿屏 | 被取代的 2.0 稿 |
|---|---|---|---|
| `/` | `apps/kiosk/src/pages/home/`、`layouts/KioskRoot.tsx` | `home` | 01 |
| `/print-scan` | `pages/print-scan/PrintScanHomePage.tsx` | `print` | 10 |
| `/print/upload` | `pages/print/PrintUploadPage.tsx` | `print-src`、`upload`、`usb` | 12 |
| `/print/desk` | `pages/print/PrintDeskPage.tsx`（检查与预览） | `pii`、`preview` | 13 |
| `/print/confirm` | `pages/print/PrintConfirmPage.tsx` | `confirm` | 14 |
| `/print/cashier` | `pages/print/PrintCashierPage.tsx` | `cashier` | 32、37 |
| `/print/progress` | `pages/print/PrintProgressPage.tsx` | `printing`、`unconfirmed` | 15 |
| `/print/done` | `pages/print/PrintDonePage.tsx` | `done` | 15 |
| `/print/pickup-claim`（排打印最后） | `pages/print/PrintPickupClaimPage.tsx` | `pickup`、`pickup-ok` | 11、33 |
| `/resume-service` | `pages/service-hubs/QxServiceHubPage.tsx`（只改 hub="resume" 这一支） | `resume`、`resume-more` | 16 的简历服务台 |
| `/resume/source` | `pages/resume/ResumeSourcePage.tsx` | `resume-src`、`upload`、`usb` | 21 |
| `/resume/parse` | `pages/resume/ResumeParsePage.tsx` | `reading` | 21 |
| `/resume/report` | `pages/resume/ResumeReportPage.tsx` | `diagnosis` | 22 |
| `/resume/optimize` | `pages/resume/ResumeOptimizePage.tsx` | `optimize` | 23 |
| `/resume/optimize/compare` | `pages/resume/ResumeOptimizeComparePage.tsx` | `compare` | 23 |

- 兼容跳转保持能用：`/print/material-check`、`/print/preview`、`/print/params` → `/print/desk`；`/resume`、`/resume/upload` → `/resume/source`；`/resume/export` → `/resume/optimize`。
- 排在三条主路之后：待机 `/screensaver`、会话超时 `/session-timeout`、从零生成 `/resume/generate` 与 `/resume/generate/preview`。
- `QxServiceHubPage` 同时服务岗位、招聘会、面试、政策四个服务台，那四个仍按 2.0 冻结，改简历服务台不能改动它们的样子。

## 设计规则要点（全文见 `app.js` 的 `RULES`）

1. **一屏一问**：每屏只问一个问题，2–4 个大选项加 1 个主按钮。
2. **上看、中选、下按**：顶部深绿意图带（约 500px）只放问题、进度、状态、二维码；中间放选项；底部放返回、问小青、主按钮，每屏位置不变。
3. **空间给交付物**：卡片按内容定高，多出的地方放「带走什么」的实物小样；一屏只留一句边界声明，放底部。
4. **只有在干活的东西才动**：读简历、等手机、出纸这类真在进行的事才有持续动画；可一键减弱动效。

数字：页面问题宋体 44–48px（首页问候 60px）、选项标题 30–40、正文 24、辅助 20–22，全站不小于 20px（含备案号）；可点区域不小于 64×64、主按钮高 88；每屏可点不超过 7 个（不含底部导航）。动效只动 transform 和 opacity：按下 120ms、进入 280ms、离开 160ms、内容每项晚 45ms、出纸每张 760ms 跟打印机回报的张数走。

## 稿里的字以代码事实为准

- 只能打 PDF、JPG、PNG；手机上传单个不超过 10MB，U 盘不超过 15MB（一体机不显示本机选文件）；Word 转换没开放时写「Word 转换暂未开放，请另存为 PDF」。
- 身份证摆放与翻面待现场核实，稿里不画摆放示意，运行页也不画。
- 「打印机就绪」「本机构免费」「A4 · 黑白和彩色 · 自动双面」「无操作多少秒清除」这类字，运行页必须从真实状态、终端能力和代码里的时长读，读不到就照实写，不照抄稿。
- 现场无人值守：不写「找工作人员」一类说法，标准句用 `apps/kiosk/src/copy/unattendedCopy.ts`。
- 岗位、招聘会只做第三方 / 官方来源入口，按钮文案守 CLAUDE.md §2 白名单。

## 验收口径

- 1080×1920 下逐状态和本目录同一屏并排截图；整行纯底色空带不超过约 105px（补空靠把主体内容做大、补代码里本来有的信息，不拉间距）。
- 关联门禁真跑通过，并做反向检查。
- 按五关逐关汇报：照稿、真机、真服务、真人试用、出错有路。

## 补稿（2026-10-26 定稿）

产品负责人 10/25 晚定「改程序前先补稿」：运行页有、稿上没画的状态和功能补进稿，稿上的字按代码事实改，给他看过再改程序。补稿后的私有页他 10/26 看过，并定了三件事：

1. **完成页「结束使用」按一下就结束**。运行页 `PrintDonePage.tsx` 现在是两步（`endArmed`「再按一次，确认结束使用」），改程序时改成一步；60 秒无操作结束、点屏幕重新计时不变。
2. **诊断方向「求职场景」里的「招聘会现场」保留**：它只是诊断参考的场景标签，不是招聘会入口，不去任何招聘会页。
3. **打印步骤统一成 4 步**（选文件 → 材料检查 → 预览与参数 → 核对价格）。运行页打印服务台现在是三步轴，改程序时一起改。

### 补了什么

- **字按代码事实改**（首页、打印、简历三条主路各屏）：清除时长（普通页 3 分钟、结果页 1 分 30 秒、完成页自己的 60 秒）、「免费」只在 0 元单写「免费试运营，本单 0 元」、打印机状态说法、彩色和双面「本机暂未开通」、份数 1–99、步骤名、各按钮名都用运行页原文；拿掉运行时没有的东西（手机已连接、手机尾号、下单人、固定金额、倒计时演完自动成功、「拿到了」、逐条修改的填数字 / 调顺序 / 二选一、单条「换个改法」）。
- **已有各屏补上运行页有的功能**：首页的身份与状态行、继续上次；打印服务台其他工具 3×2、到机码说明、隐私与电子签说明、免登录反馈；选文件的纸质扫描入口；隐私检查逐处「保留 / 遮挡」与计数；预览的 ±10 份、双面长边短边、更多设置（方向、缩放、页码）、按文件事实给出的参数建议；收银台的支付通道、两种扫码方式、退出支付、刷新付款结果；出纸进度四步与状态说明；完成页的再印一份、订单去向、查看订单 / 使用帮助 / 反馈；到机码的历史 10 位码、扫码枪说明、核验成功的订单号与金额、同码续打说明。
- **简历流程按运行页补齐**：服务台（含小青不可用时的手动出路）、简历在哪（手机 / U 盘 / 纸质扫描）、诊断方向（默认通用诊断，定向诊断再选维度、岗位、行业，其余条件放「更多条件」）、读简历、诊断报告（六维、先改三处、导出后才可打印和扫码带走）、改动清单、逐条选择（含新增事实先勾「这是我的真实信息」、自己写）、编辑（模板、版式、AI 精简与排版、导出前核对事实）、导出与打印（PDF / DOCX / TXT / MD）。
- **状态样式板 7 屏**（以后所有页面的同类状态照这七屏做）：

| 屏 | 状态 | 对应运行页 |
|---|---|---|
| `st-loading` | 加载：打印服务台正在确认本机能力 | `/print-scan` capability-loading |
| `st-empty` | 空：检查与预览没有待处理的文件 | `/print/desk` 缺文件（标题是 W6 门禁钉的原句） |
| `st-error` | 出错：文件没传上来 | `/print/upload` 过大、格式拒收、上传失败 |
| `st-unavailable` | 不可用：在线服务暂时连不上 | `/resume-service` 后端未就绪 |
| `st-device-off` | 设备停用：打印机缺纸 | `/print-scan` device-off |
| `st-unconfirmed` | 结果未确认：打印机没有回报 | `/print/done` PRINT_JOB_UNCONFIRMED（与 `unconfirmed` 屏同一套） |
| `st-ai-down` | 小青不可用：这次没诊断出来 | `/resume/report` 诊断失败且 AI 停用（含当日额度用完） |

### 怎么核的

- 事实对照：Grok 逐页读 `main@0b4b5770b` 源码出对照，Codex 对代码逐条核屏上的字，agy 做反方；每条意见由 Claude 对源码核过再改。
- 1080×1920 截了 50 个状态（含已登录、打印机离线、小青不可用、更多设置、定向诊断、更多版式、核对事实弹层、导出后）：控制台 0 报错、内容不超出屏幕、全站最小字 20px、整行纯底色空带都不超过 105px；三条主路范围内没有「工作人员」类说法。
- 号码位一律写示例 `183-6916-1921`，运行时号码与服务时间从后台读，读不到不显示。

## 冻结

`apps/kiosk/scripts/verify-kiosk-touch-frozen.mjs`（`pnpm --filter @ai-job-print/kiosk verify:kiosk-touch-frozen`，进 CI）逐个比对本目录稿文件与 `FROZEN.json` 里的 sha256，改动、新增、删除都算红；`README.md`、`FROZEN.json` 不在冻结范围。改稿只在产品负责人同意之后：改完在 `apps/kiosk` 下跑 `node scripts/verify-kiosk-touch-frozen.mjs --update` 重写清单，并在 `docs/progress/current-progress.md` 写明谁同意的、改了什么、为什么。
