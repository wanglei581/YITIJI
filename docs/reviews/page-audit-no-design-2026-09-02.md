# 无新设计稿页面体检报告（10 页）— 2026-09-02

## 背景与口径

这 10 条路由对应的原型（`docs/design/kiosk-redesign-2026-08/` 42–51 号）是空壳（只有空的
`#body-root`，引用的 14 个 JS/CSS 在仓库内不存在），产品负责人裁决**不做视觉迁移，只做体检**。

因此本报告**不以「和新稿差多少」为判断标准**，只回答「这一页本身有没有真问题」。
配色 / 字体 / 圆角 / 间距与其它页不同 —— 不算问题，未记录。

## 验证环境（结论可信度的前提）

| 项 | 状态 |
|---|---|
| Kiosk dev server | `localhost:5279`（worktree `dazzling-hodgkin-24cdea`），`VITE_API_MODE=http` |
| 后端 API | **本次已拉起** `localhost:3010`；空 `dev.db` 跑 `prisma migrate deploy` + `seed.ts` / `seed-companies` / `seed-fairs` / `seed-venue-guide` |
| 数据 | 企业 3 家、招聘会 3 场（`fair-uni-campus-2026q2` 含 8 企业 / 7 展区）、岗位 13 条；**线下招聘机构 0 条（无 seed）** |
| Redis | 未运行（`ioredis` 报错），本次涉及的只读端点不受影响 |
| 截图 | `scripts/dev/shot-route.sh`，1080×1920，Chrome headless 全新 profile |
| 舞台缩放 | **实测 scale = 1**（`.kiosk-stage` computed transform = `matrix(1,0,0,1,0,0)` @1080×1920），故 48px 断言按 1:1 计 |
| 触控扫描 | 9 条 kiosk 路由逐一 `getBoundingClientRect()` 扫描全部可点元素，**0 个 < 48px** |
| 合规文案 | 10 页 + `CampusTabs` 全量 grep「一键投递/立即投递/平台投递/收简历/候选人管理/面试邀约/简历筛选」，**命中项全部是否定式免责声明**（"不代收简历""不接收简历"），无越界 |

> 空白测量说明：像素扫描按行统计横向色差（阈值 6/255，最小连续 200px）。
> 带虚线边框的容器会抬高行内色差，故对这类页面另按内缩 x 区间重扫，报告中已注明取值区间。

---

## 总览

| 路由 | 结论 | 最高严重度 |
|---|---|---|
| `/offline-agencies` | 3 个问题 | 高 |
| `/companies` | 1 个问题 | 低 |
| `/job-fairs/:id/companies` | 5 个问题 | 高 |
| `/jobs/online-platforms` | 2 个问题 | 中 |
| `/contract-review` | 路由被功能开关关闭，**运行时无法体检** | — |
| `/policy-service` | 无问题 | — |
| `/campus` | 3 个问题 | 高 |
| `/toolbox` | 1 个问题（页面本体未能运行时验证） | 低 |
| `/upload/phone` | 1 个问题 | 低 |
| `/renshi` | 无问题 | — |

外加 1 条跨页问题（顶栏品牌文字粘连）。

---

### /offline-agencies

**结论**：3 个问题
**截图**：`/tmp/audit/offline-agencies.png`
**数据前提**：`GET /kiosk/offline-agencies` 返回 `total: 0`，本次只验证到**空态形态**；有数据形态未验证。

1. **[高 · §9 伪造能力] 列表把每一家机构都写死成「正常收录 + 已审核」，无视后端 `status`**
   用户会遇到：一家后端状态为非 `open`（暂停收录）的机构，在列表里仍显示绿点「正常收录」和
   「机构信息已审核」；只有点进详情才会翻成「暂停收录」。同一份数据两页两个结论。
   证据：
   - `apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx:24` `className="oa-st open"` 与 `:26` 文案
     「正常收录」都是字面量，`agency.status` 从未被读取；`:44` 的 `<span className="jf-chip ok">机构信息已审核</span>` 同样恒定。
   - DTO 明确要求按字段渲染：`apps/kiosk/src/services/api/offlineAgencies.ts:88-89`
     「机构当前状态（'open' | 'rest'），来自后端 status 字段；**前端按此渲染徽章**」。
   - 兄弟页写法正确，可直接对照：`apps/kiosk/src/pages/offline-agencies/OfflineAgencyDetailPage.tsx:43`
     `const isOpen = agency.status === 'open'`，`:57` `oa-st ${isOpen ? 'open' : 'rest'}`，`:59` `{isOpen ? '正常收录' : '暂停收录'}`。
   - CSS 里 `.oa-st.rest` 变体存在但本页永不使用（`apps/kiosk/src/pages/styles/jobs-companies-fusion.css:151`）。
   建议：把 `AgencyRow` 的徽章改成与详情页同一套 `isOpen` 三元表达式即可，无需新增结构。

2. **[中] 「区域」筛选是个假控件**
   用户会遇到：看见一行「区域 / 全部区域」，样式是「已选中」的深色 chip，点下去没有任何反应，
   也没有第二个区域可选 —— 看起来是坏掉的筛选器。
   证据：`OfflineAgenciesPage.tsx:123-124` 两个元素都是 `<span>`，无 `onClick`；
   运行时 DOM 复核 `.jf-filter-bar` 前两个子节点确为 `SPAN.jf-filter-label` / `SPAN.jf-f-chip.on`。
   后端其实已支持该筛选：`offlineAgencies.ts` 的 `OfflineAgencyListParams` 含 `district` / `service` / `orgType`。
   建议：要么接上 `district`（后端现成），要么整行删掉；不要留一个恒为「选中」的死 chip。

3. **[低] 空态留白 1121px，且不给出路**
   证据：像素扫描（x 120..960）blank `y=391..950`（559px）+ `y=1117..1679`（562px）。
   空态只有一句「暂无线下招聘机构信息」，无任何按钮。
   建议：空态里补一个「返回岗位信息」或「查看线上招聘平台」的次级出口。

---

### /companies

**结论**：1 个问题（功能与合规均正常）
**截图**：`/tmp/audit/companies.png`

页面本身质量较好，已核对通过的项：3 家企业为真实接口数据；类型 / 行业 / 招聘 / 来源 / 省市区
筛选全部接线；`查看在招岗位` 在 `openJobCount === 0` 时用 `aria-disabled` + 常显原因而非原生
disabled；`/companies/:id?tab=jobs` 深链被 `CompanyDetailPage.tsx:162` 正确消费；触控 0 个不达标；
底部合规提示使用白名单文案「去来源平台投递 / 扫码投递」。

1. **[低 · §9] 「最近更新 · 实时数据」徽章与页面状态无关，加载失败时仍然显示**
   用户会遇到：后端断开时正文显示「企业数据加载失败，请检查后端连接后重试」，而页头右上角
   同时还挂着「最近更新 · 实时数据」。
   证据：`apps/kiosk/src/pages/companies/CompaniesPage.tsx:295` 徽章作为 `KioskPageFrame` 的 `badge`
   属性渲染，位于 `:379-418` 的 `loading / error / empty` 三分支**之外**；且这串文案没有任何时间戳支撑。
   建议：删掉该徽章，或改为绑定真实同步时间并在 `state !== 'ready'` 时不渲染。

---

### /job-fairs/:id/companies

**结论**：5 个问题（本批最差的一页）
**截图**：`/tmp/audit/fair-companies.png`（`fair-uni-campus-2026q2`，8 家企业）、
`/tmp/audit/fair-companies-empty.png`（空态复现）

1. **[高 · §9 伪造能力] 所有企业规模都被兜底成「中型」，与后端数据矛盾（当前数据即可复现）**
   用户会遇到：阿里巴巴、腾讯、字节跳动、京东、美团、蚂蚁集团、拼多多 —— 8 家全部标注「中型」。
   而「中型」在本项目字典里的定义是 **100-999 人**（`apps/kiosk/src/types/fair.ts:120`
   `medium: '中型企业（100-999人）'`）。
   证据：
   - 后端实际返回 `scale: ">2000"`（`GET /job-fairs/fair-uni-campus-2026q2/companies` 实测）。
   - `apps/kiosk/src/services/api/httpAdapter.ts:192-196`：

     ```ts
     function coerceScale(scale?: string | null): FairCompanyDTO['scale'] {
       return scale && (VALID_SCALES as readonly string[]).includes(scale)
         ? (scale as FairCompanyDTO['scale'])
         : 'medium'
     }
     ```

     `VALID_SCALES` 只有 `startup|small|medium|large|enterprise`，`">2000"` 不在其中 → 落 `'medium'`。
   - `FairCompaniesPage.tsx:136` 直接 `COMPANY_SCALE_SHORT[company.scale]` 渲染成「中型」。
   建议：`coerceScale` 的 default 分支不能返回一个具体档位。要么补上后端实际取值的映射
   （`">2000"` → `enterprise`/`large`），要么返回 `undefined` 并让 `FairCompaniesPage` 在无法判定时
   不渲染这枚 tag —— 这与 §9「不把未知显示成一个具体值」是同一条。

2. **[高 · §9 伪造能力] 「未签到」是前端凭空造的，后端根本没有签到字段**
   用户会遇到：每家参展企业都挂着「未签到」标签，暗示现场签到状态已被追踪；实际上系统不做签到。
   证据：
   - 接口 payload 的 key 列表里**没有** `checkinStatus`（实测 keys：`boothNumber, coverImageUrl,
     createdAt, description, founded, headquarters, hiringTags, honorTags, id, industry, jobFairId,
     jobsCount, logoUrl, name, positions, registeredCapital, scale, sourceUrl, updatedAt, zoneId`）。
   - `httpAdapter.ts:216-217` 写死：`// 模型无现场签到 → 合规占位（不做签到）` / `checkinStatus: 'pending'`。
   - `FairCompaniesPage.tsx:137-139` 把这个「占位」当事实渲染成可见 chip（`CHECKIN_LABELS.pending = '未签到'`）。
   适配层的注释说明它本意是个惰性占位，**bug 在页面把占位当事实展示**。
   建议：页面在 `checkinStatus` 无真实来源时不渲染该 chip（或适配层不再伪造该字段，让它保持 undefined）。

3. **[中] 加载 / 错误 / 空态直接 early-return，页头和返回按钮一起消失**
   用户会遇到：任何一场没有参展企业的招聘会（或 id 失效），整屏只剩一行小字「暂无企业数据」，
   **没有标题、没有「返回详情」**，只剩全局底部导航；无法回到该招聘会。
   证据：`FairCompaniesPage.tsx:61-77` 三个分支都在 `KioskPageFrame` **之前** return，
   而 `packages/ui/src/components/EmptyState.tsx` 不含任何导航。
   运行时复现：`/job-fairs/does-not-exist-fair/companies` → 页面 innerText 仅
   「…| 暂无企业数据 | 首页 | AI顾问 | 我的」，全部 `<button>` 只有底部三个 tab。
   留白实测（x 60..1020）：`y=91..883`（792px）+ `y=971..1827`（856px）= 1648px / 1920。
   建议：把三个状态放进 `KioskPageFrame` 内部（保住 `onBack`），空态再补一句可操作出口。

4. **[中] 「重试」按钮不重试**
   证据：`FairCompaniesPage.tsx:67-71` 的 `onRetry={() => navigate('/job-fairs/${fairId}')}`，
   而 `packages/ui/src/components/ErrorState.tsx:28-31` 该按钮的文案固定是「重试」。
   用户点「重试」会被静默带离当前页。
   建议：改成重新触发数据加载，或把按钮文案换成「返回招聘会详情」。

5. **[低] 行业显示英文原始枚举**
   用户会遇到：中文界面里出现「internet」「finance」。
   证据：`FairCompaniesPage.tsx:145` `{company.industry}` 直出；适配层 `httpAdapter.ts:203`
   `industry: c.industry ?? ''` 不做映射；接口返回 `"internet"`。截图可见。
   对照：`/companies` 用 `COMPANY_INDUSTRIES` 映射，`/campus` 用 `CampusTabs.tsx:49 industryLabel()` 映射
   —— 只有本页漏了。
   建议：复用 `industryLabel()` 或 `COMPANY_INDUSTRIES`。

6. **[低 · §9] `syncTime={fair.syncTime ?? fair.startTime}` —— 拿「开始时间」冒充「同步时间」**
   证据：`FairCompaniesPage.tsx:171`。而 `FusionSourceMeta` 本身已经正确处理缺失情况：
   `apps/kiosk/src/pages/jobs/components/W4Presentation.tsx:124` `syncTime?: string`、
   `:129` `syncTime ? ['同步时间', formatW4Date(syncTime)] : null` —— 缺失时它会**整行不渲染**。
   所以这个 `??` 不是防御，而是主动把该隐藏的行填上一个错的值（§10 要求同步时间准确）。
   说明：`ExternalJobFair.syncTime` 当前类型为非空 `string`（`packages/shared/src/types/fair.ts:64`），
   种子数据也有值，**故当前不可复现**；属于埋雷。同款写法另见 `FairMapPage.tsx:259`、
   `FairMaterialsPage.tsx:221`（不在本次 10 页范围内，未展开）。
   建议：删掉 `?? fair.startTime`，交回给 `FusionSourceMeta` 自行省略。

---

### /jobs/online-platforms

**结论**：2 个问题（合规文案正确，无越界）
**截图**：`/tmp/audit/online-platforms.png`

1. **[中] 1091px 大片空白 —— 页面只用掉 38% 屏高**
   证据：像素扫描 blank `y=736..1827`，height **1091px**（1920 的 57%）。
   4 张平台卡片 + 一条合规提示在 y≈736 就结束了，其下到底部导航之间全空。
   建议：这页不需要重新设计，把卡片高度/间距按 27 寸竖屏放大，或把合规说明与「如何辨认官方域名」
   的指引展开，即可填满；不要为了填空造假数据。

2. **[中] 打开第三方平台不写「外部跳转记录」，与 §10 数据边界不一致**
   用户会遇到：从这页扫码去 Boss直聘 / 前程无忧后，「我的 → 浏览 / 跳转记录」里查不到这次跳转，
   而从岗位详情、企业详情、招聘会等页跳出去都会被记录 —— 同一类行为记录口径不统一。
   证据：全仓 8 个页面调用 `recordExternalJump`
   （`JobDetailPage.tsx:110,120`、`CompanyDetailPage.tsx:184,188`、`JobFairsPage.tsx:198`、
   `JobFairDetailPage.tsx:158,163`、`JobFairCheckinPage.tsx:156`、`FairCompanyDetailPage.tsx:126`、
   `CampusPage.tsx:167`、`RenshiPage.tsx:33,41`），
   而 `apps/kiosk/src/pages/jobs/OnlinePlatformsPage.tsx` **完全没有 import `activity`**；
   `openPanel()`（`:48-50`）只 `setActivePlatform`。
   CLAUDE.md §10：「系统只记录：浏览 / 收藏 / **外部跳转** / 打印 / AI服务调用」。
   建议：在 `openPanel` 里补一次 `recordExternalJump(getToken(), ...)`。
   注意合规边界不变 —— 只记录「打开了来源平台入口」，**不记录投递结果**。

> 补充（不计为问题，仅备案）：4 个平台是代码里的 `PLATFORMS` 常量
> （`OnlinePlatformsPage.tsx:17-42`），没有后台管理入口。内容本身诚实（只展示可核对的官方域名，
> 未替第三方编造标语，代码注释也说明了这个取舍），但平台改名 / 换域名只能改代码发版。

---

### /contract-review

**结论**：路由在当前构建配置下被功能开关关闭，**运行时无法体检**（不是缺陷）
**截图**：`/tmp/audit/contract-review.png` —— 截到的是**首页**，不是合同审查页。

- 现象：访问 `/contract-review` 被 `<Navigate to="/" replace />` 重定向到首页。
- 原因：`apps/kiosk/src/routes/index.tsx:89`
  `const contractReviewEnabled = import.meta.env.VITE_ENABLE_CONTRACT_REVIEW === 'true'`；
  `:122-146` 三条 `/contract-review*` 路由在 flag 为假时全部替换为重定向。
  本 worktree 的 `apps/kiosk/.env.local` 未设置该变量。
- 这是**既定产品口径**，不是 bug：`apps/kiosk/.env.example` 明确写「合同审查 production_default=false；
  仅在独立发布授权完成后显式设为 true」。
- 代码走读（未运行时验证）：`ContractReviewHomePage.tsx` 为完整的 3 步流程第 1 步，
  上传（本机 15MB / 扫码 10MB 双通道）+ 合同类型 + 知情同意版本号三件套齐全，
  提交前校验 `consentScope`/`consentChecked`，未见伪造能力或死链。
- **未验证项**：该页的实际渲染、布局、留白、触控尺寸。
  如需体检，请在 `.env.local` 设 `VITE_ENABLE_CONTRACT_REVIEW=true` 后重跑。

---

### /policy-service

**结论**：无问题
**截图**：`/tmp/audit/policy-service.png`

逐项核对通过：

- **死链全清**：8 个跳转目标全部对过路由表与 tab 白名单 ——
  `/renshi?tab=policy|social|register` ⊂ `renshi/shared.ts:15` 的 `VALID_TABS`；
  `/me/favorites?tab=policy` 被 `MyFavoritesPage.tsx:34-38` 的 `VALID_FAVORITE_TABS` 接受；
  `/assistant`、`/me/activity`、`/me/ai-records` 均在路由表内。
  代码里还留有上一轮修掉同类问题的记录（`:90-93` 把不在白名单的 `?tab=subsidy` 改回 `/renshi`），
  说明这一类已被系统性处理过。
- **不伪造能力**：`ServiceReadinessStrip` 绑定真实 `useApiReadiness()`；API 未就绪时卡片
  `disabled` 且文案从「进入」变「等待服务」。
- 触控 0 个不达标；无 >200px 的内容区空白（底部 221px 为正文与底部导航之间的收尾留白，非塌陷）。

> 轻微观察（不计为问题）：7 张能力卡片放进 2 列栅格，最后一张「政策收藏」独占左列、右列空一格。

---

### /campus

**结论**：3 个问题
**截图**：`/tmp/audit/campus.png`，hero 放大图 `/tmp/audit/_campus_hero.png`

1. **[高] Hero 区文字近乎不可见，实测对比度 1.06:1**
   用户会遇到：整页最重要的信息 —— 招聘会名称「AI 产业校企合作专场招聘会」、日期角标
   「2026.06.15 — 06.17」、场馆、参展企业数、招聘岗位数 —— 全是淡到几乎看不见的幽灵字。
   截图放大 1.5 倍后仍难以辨认。
   证据（运行时 `getComputedStyle`，非目测）：
   - `.campus-hero` → `background-color: rgba(0, 0, 0, 0)`（透明），`color: rgb(244, 241, 232)`
   - `h1` → `color: rgb(244, 241, 232)`
   - `--kp-dark` → **空字符串（该作用域内未定义）**
   - 像素采样：字形最深像素 `(244,241,232)` vs 背景 `(250,248,244)` → **对比度 1.06:1**
     （WCAG AA 正文需 4.5:1，大字需 3:1）
   根因：`apps/kiosk/src/pages/styles/campus-policy-fusion.css:446-452` 的 hero 设计是
   「深底 + 浅字」——

   ```css
   .campus-proto .campus-hero {
     background: var(--kp-dark);
     color: var(--k-paper, var(--color-canvas));
   }
   ```

   但 `--kp-*` 整套令牌只定义在 `.kproto` 上（同文件 `:6-34`，`--kp-dark: var(--k-ink)` 在 `:24`），
   而 `CampusPage` 渲染的是 `<div className="campus-proto">`（`CampusPage.tsx:246`）套在
   `KioskPageFrame tone="clay"` 里，**拿不到 `.kproto` 作用域**。
   于是 `background: var(--kp-dark)` 因变量未定义而在计算值阶段失效被丢弃（背景退回透明的浅色底），
   而 `color` 那行因为有 `var(--k-paper, ...)` 的兜底照常生效 —— 浅字落在浅底上。
   建议（改一处即可）：在 `.campus-proto` 上补 `--kp-dark`（或让 hero 直接用 `var(--k-ink)`），
   不要动 `.kproto` 的定义以免外溢。

2. **[低] 「重试」按钮实际是「回首页」，且该页隐藏了底部导航**
   用户会遇到：没有校园主题招聘会时（`error || !fair`），整屏只有一句
   「暂无校园招聘会数据，请稍后再试」和一个写着「重试」的按钮，点下去被送回首页。
   由于 `KioskRoot.tsx:181` 对校园专区 `hideBottomNav`，这个误导按钮是屏幕上**唯一**的控件。
   证据：`CampusPage.tsx:209-218`，`onRetry={() => navigate('/')}`；按钮文案固定为「重试」
   （`ErrorState.tsx:28-31`）。同 `/job-fairs/:id/companies` 的第 4 条是同一个模式。
   说明：本次种子数据里存在校园招聘会，**该错误态未在运行时复现**，结论来自代码走读。
   建议：文案改「返回首页」，或让 `onRetry` 真正重新拉取。

3. **[低] 精确计数后面加「+」**
   用户会遇到：「招聘岗位 18+」「行业覆盖 1+」—— 数字是精确算出来的，「+」让它显得是个下限估计；
   「1+」尤其别扭。
   证据：`CampusPage.tsx:292` `招聘岗位 {jobCount}+`（`jobCount` 来自
   `stats?.totalPositions ?? fair.jobCount ?? companies.reduce(...)`，是确定值；
   兜到最后一档且无岗位时会渲染成「0+」）；
   `CampusTabs.tsx:126` `industryCount > 0 ? \`${industryCount}+\` : '—'`。
   建议：去掉「+」，或仅在确实做了截断时才加。

> 已核对**不适用**于本页：`/job-fairs/:id/companies` 的 `coerceScale`「中型」与伪造「未签到」
> 两条**不会**在 `/campus` 出现 —— `CampusTabs.tsx` 既不渲染 `scale` 也不渲染 `checkinStatus`，
> 且行业走了 `industryLabel()` 映射。

---

### /toolbox

**结论**：1 个问题；**页面本体在本环境无法运行时验证**
**截图**：`/tmp/audit/toolbox.png`

- 现象：`/toolbox` 渲染的**不是** `ToolboxZonePage`，而是 `ToolboxCapabilityBoundary` 的
  能力未开启回退页：「本机暂未开启百宝箱服务」+「返回首页」。
  证据：`apps/kiosk/src/routes/index.tsx:200-202` 该路由挂在 `ToolboxCapabilityBoundary` 下；
  `apps/kiosk/src/auth/KioskCapabilityGuard.tsx:75-77` `capabilityReady(state)` 为假时返回
  `<CapabilityUnavailable>`。本机终端未配置百宝箱能力。
- 这是**诚实的能力门禁**，不算伪造能力；但也意味着下面这条是本次唯一能测的东西。

1. **[低] 能力未开启回退页在 1080×1920 上是一张小卡片浮在 1615px 空白里**
   证据：像素扫描（x 60..1020）blank `y=91..991`（900px）+ `y=1112..1827`（715px）= **1615px / 1920**；
   卡片本身仅约 120px 高，其中提示文字为小字号，不是一体机触控尺度。
   建议：该回退页是 `KioskCapabilityGuard` 共用组件，改动会影响智慧校园等其它能力门禁；
   若要修，按一体机尺度放大文案与按钮并居中留白即可，不必新建页面。

> `ToolboxZonePage.tsx` 本身代码走读**未发现问题**：`config.enabled` 为假时给真实空态
> 「待配置 / 后续功能上线后将在这里展示」，不可启动项走 `isLaunchableKioskAppItem` 置灰，
> 外部 H5 / 二维码启动都有离场提示弹窗，合规说明到位。
> **未验证项**：该页实际渲染、布局与留白。

---

### /upload/phone

**结论**：1 个问题
**截图**：`/tmp/audit/phone-upload.png`（1080×1920，无参数 → 失效态）、
`/tmp/audit/phone-upload-mobile.png`（390×844，带参数 → 正常上传态）

> 重要口径：本页是**手机端页面**（`data-kiosk-viewport="mobile"`，由一体机二维码拉起），
> 不是一体机屏。1080×1920 截图上量到的 ~900px 空白**不构成缺陷**，已按 375×812 复测：
> `document.documentElement.scrollHeight === innerHeight === 812`，内容恰好铺满、无溢出、无横向滚动。

已核对通过：无参数时显示「上传链接已失效 / 请回到一体机屏幕重新扫码」，不伪装可用；
上传成功前不显示任何「已完成」；隐私说明明确（一次性令牌、不登录、到期清理）；
文件大小与格式限制与 `purpose` 绑定；触控扫描唯一命中的 1×1 `<input>` 是 `sr-only` 隐藏输入，
真实点击目标是包裹它的大 `<label>`（`PhoneUploadPage.tsx:171-188`）—— **误报，不计为问题**。

1. **[低] 「二维码 10 分钟内有效」是手抄的常量，且在过期报错时仍然照常显示**
   用户会遇到：链接因过期而报错后，同屏右上角还在说「二维码 10 分钟内有效」。
   证据：`PhoneUploadPage.tsx:220`
   `{state === 'uploading' ? '请勿关闭本页' : '二维码 10 分钟内有效'}` —— 与 `state === 'error'` 无关。
   数值本身**当前是准确的**（已核对后端 `services/api/src/upload-sessions/upload-sessions.service.ts:87`
   `const SESSION_TTL_SECONDS = 10 * 60`），但两处各写各的，后端调 TTL 时前端不会跟着变；
   而且页面只从 hash 拿 `sessionId/token/purpose`，拿不到接口已经算好的 `expiresAt`
   （`upload-sessions.service.ts:137,151`），所以也做不了真实倒计时。
   建议：过期/错误态下不再显示该行；若要留，让二维码链接一并带上 `expiresAt` 并显示真实剩余时间。

---

### /renshi

**结论**：无问题
**截图**：`/tmp/audit/renshi.png`

这是本批质量最高的一页，逐项核对通过：

- **空态诚实且可判别**：政策库 0 条时明确显示「政策库还没有内容」，并把「通用办事指引」
  单独标注为「本机整理参考 · 不属于政策库 · 办理以官方发布为准」，两类内容**没有合并成一个数组**
  （`RenshiPage.tsx:70-79` 有注释说明：合并会让运营无法判断种子政策到底进没进去）。
- **不夸大来源权威性**：`PolicyServiceHubPage.tsx:5-10` 记录了 2026-08-11 的整改 ——
  因为后端无法核验官方域名，全链路已把「官方口径 / 官方入口」改为「来源链接 / 由来源机构提交并经平台审核后展示」。
- **不静默截断**：`RenshiPage.tsx:81-84`，取回条数少于服务端总数时如实说明。
- 外部跳转记录接线正确（`:33,41`），内置指引因无服务端实体而跳过记录，口径自洽。
- 5 个 tab 切换正常，两栏布局填充充分，触控 0 个不达标，无 >200px 空白。

---

## 跨页问题

**[低] 顶栏品牌名与副标题粘连成「KSK-001AI求职打印服务终端」**

用户会遇到：终端编号和产品名之间没有分隔，读成「KSK-001AI」。
证据：`apps/kiosk/src/layouts/KioskRoot.tsx:183-186`，
`brandTitle={\`就业服务大厅 · ${terminalCode}\`}` 与 `brandSubtitle={'AI求职打印服务终端'}`
在旧壳层里相邻渲染且无间隔；运行时 DOM innerText 实测为
`就业服务大厅 · KSK-001AI求职打印服务终端`。
影响范围：本批中使用旧壳层的 7 页（`/offline-agencies`、`/companies`、`/job-fairs/:id/companies`、
`/jobs/online-platforms`、`/toolbox`、`/renshi` 及空态页）；
走 V6 壳层的 `/policy-service`、`/contract-review`(首页) 正常显示「职易达 AI 求职操作系统 · KSK-001」。
建议：在壳层给 `brandSubtitle` 加左间距或分隔符，改一处即可。

---

## 复核为「正常」的项（避免后续重复排查）

- **设备状态未伪造，且 fail-closed 有效**：顶栏在心跳新鲜时显示绿色「打印机在线」，
  心跳过期后自动转红「打印机离线」；同时刻接口 `GET /terminals/KSK-001/printer-status`
  返回 `{"printerStatus":"ok","lastSeenAt":"2026-09-02T14:52:37.596Z","isOnline":false}` —— 前后端一致。
  `apps/kiosk/src/hooks/useTerminalDeviceStatus.ts:1-13` 的约束（未知/失败/心跳过期一律不显示在线、
  Agent 不上报耗材则 `tonerKnown=false`）在实测中成立。首页「纸张/碳粉/扫描仪：未单独上报」
  也是正确写法。
- **合规文案零越界**：见「验证环境」表最后一行。
- **触控尺寸零不达标**：9 条 kiosk 路由全量扫描，scale 已实测为 1。
- `/policy-service` 的 8 个跳转目标、`/companies` 的 `?tab=jobs` 深链、`/renshi` 的 5 个 tab
  均已对照路由表与白名单验证，无死链。

## 未验证 / 受限项（如实记录）

| 项 | 原因 |
|---|---|
| `/contract-review` 页面渲染 | `VITE_ENABLE_CONTRACT_REVIEW` 未开，路由重定向到首页 |
| `/toolbox` 页面本体渲染 | 本机未开启百宝箱能力，只能看到能力门禁回退页 |
| `/offline-agencies` 有数据形态 | 该表无 seed，接口 `total: 0`，只验证到空态 |
| `/campus` 错误态、`/job-fairs/:id/companies` 的**错误**态 | 种子数据齐全，未触发；空态已用不存在的 fair id 复现 |
| `coerceScale` 之外的 `FairMapPage` / `FairMaterialsPage` 同款 `?? startTime` | 不在本次 10 页范围，仅备案 |
| 真机（Windows 一体机 / 打印扫描） | 本次为浏览器体检，未涉及硬件链路 |
