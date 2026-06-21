[codeagent-wrapper]
  Backend: claude
  Command: claude -p --dangerously-skip-permissions --setting-sources  --output-format stream-json --verbose -
  PID: 35758
  Log: /var/folders/wv/tfvgh3xd5g775gnqq5wpfbkm0000gn/T/codeagent-wrapper-35758.log
  Web UI: http://localhost:55934
  Session-ID: 1e8d7100-0b9b-459f-9f96-209e3c6115c6
I have everything I need. Here's my pre-split analysis.

---

# Branch 3 拆分前分析 — 招聘会/校园招聘页面零行为拆分

读取确认的事实：
- `CampusPage.tsx` 897 行 / `JobFairDetailPage.tsx` 857 行 / `FairCompanyDetailPage.tsx` 647 行，门槛 500，三者均 RED。
- `campus/` 下**没有** `components/`、`types.ts`、`utils.ts`（需新建）；`job-fairs/` 下已有 `components/`，但**没有** `types.ts`/`utils.ts`。
- `job-fairs/components/MapBlock.tsx` 已存在（共享版），`CampusPage` 已在引用它；但 **`JobFairDetailPage` 内部另有一份本地 `MapBlock`，两者并不相同**（见 Critical-1）。

---

## 🔴 Critical（会直接破坏“零行为”红线，必须避免）

### C-1. `JobFairDetailPage` 的本地 `MapBlock` ≠ 共享 `MapBlock`，禁止顺手合并
`JobFairDetailPage.tsx:361-382` 的本地 `MapBlock` 用 `const cls = 'h-full min-h-[15rem] w-full'`；而 `job-fairs/components/MapBlock.tsx:21` 是 `const cls = 'h-full w-full'`（**无 `min-h-[15rem]`**）。两者图标占位文案、iframe 逻辑一致，但**最小高度不同**。

- 风险：若拆分时“看到已有共享 MapBlock 就 import 它”删掉本地版，详情页地图块在无图/无经纬度时会塌高 → 视觉行为改变。
- 正确做法：把本地 `MapBlock` **原样**搬到 `job-fairs/components/JobFairMapBlock.tsx`（保留 `min-h-[15rem]` 与 `AMAP_KEY` 逻辑），或保留在主文件不动。**不要**复用共享 MapBlock。

```diff
--- a/apps/kiosk/src/pages/job-fairs/components/JobFairDetailMapBlock.tsx
+++ b/apps/kiosk/src/pages/job-fairs/components/JobFairDetailMapBlock.tsx
@@
+// 详情页专用：保留 min-h-[15rem]，与列表/导览页共享 MapBlock 故意不同，勿合并
+function MapBlock({ lat, lng, mapImageUrl, venue }: { ... }) {
+  const cls = 'h-full min-h-[15rem] w-full'   // ← 必须保留，否则地图块塌高
```

### C-2. 三处 `STATUS_CONFIG` 语义不同，禁止抽成单一共享常量
- `CampusPage.tsx:52-56`：Hero 渐变背景用，值是 `bg-white/20`、`bg-emerald-400/90` 等**半透明白系**。
- `JobFairDetailPage.tsx:44-48`：彩色 pill，值是 `bg-blue-50/text-blue-600` 等。
- 二者 key 相同（upcoming/ongoing/ended）但样式完全不同。若被合并到 `types.ts` 统一导出，必然有一页样式被改。
- 正确做法：各自留在本页的 `types.ts`/`utils.ts`（**campus 与 job-fairs 各一份**），互不引用。

### C-3. 两个 `CompaniesTab` 看似重复，实则布局不同，禁止跨目录合并
- `CampusPage` 的 `CompaniesTab`（600-731）：单列 `grid-cols-1`，外层 `space-y-4`。
- `JobFairDetailPage` 的 `CompaniesTab`（539-668）：`grid lg:grid-cols-3` + `lg:col-span-1/2` 两栏，岗位卡 `sm:grid-cols-2`。
- helper（`positions`/`categories`/`visiblePositions`）逻辑一致，但 JSX 容器/栅格不同。合并成一个共享组件会改其中一页的布局。
- 正确做法：分别落到 `campus/components/CompaniesTab.tsx` 与 `job-fairs/components/CompaniesTab.tsx`，**不抽公共组件**。

### C-4. 不得触碰任何跳转/二维码/合规文案
搬运过程中以下内容必须**逐字符不变**：
- 路由：`/job-fairs/${id}/materials`、`/companies/${companyId}`、`/print/preview`(state: file/returnUrl/returnLabel)、`/resume/source?intent=...`、`/assistant`、`/jobs`、`/print/upload`、`/job-fairs/${id}/map`。
- 埋点：`recordBrowse` / `recordExternalJump(... 'external_appointment' | 'external_apply')`、`getToken()`。
- 二维码：`SourceUrlQr value={...}`、`isValidSourceUrl`、`buildNavUrl`、`getTerminalId`。
- 合规文案：QrModal/QrOverlay 的 `note`、底部“本系统仅展示…不接收简历…”、按钮文案“扫码预约/去来源平台投递/打印企业资料/打印岗位清单”等。
- `FairCompanyDetailPage` 的 `PrintFile` 体积/页数公式（534-547）与 `COMPANY_SCALE_LABELS`（来自 `../../types/fair`，**非**新建的本地 types.ts，勿混淆）。

---

## 🟡 Warning（不当操作会引入编译/lint 失败或隐性回归）

### W-1. lucide 图标 import 必须按文件重新分配，否则 noUnusedLocals/eslint 报错
三个主文件顶部都 import 了大量图标。拆出组件后：
- 主文件只能保留**自己仍用到**的图标（如 Campus 主体只用 `ChevronLeftIcon/MapPinIcon/BuildingIcon/BriefcaseIcon`）。
- 每个子组件各自 import 自己用到的图标。
- 遗漏裁剪 = 未使用 import 报错；漏 import = 引用未定义。建议逐组件核对图标清单后再下手。

### W-2. 各 Tab 组件内部自带 `useNavigate()`，搬运时要保留 hook 调用
`OverviewTab`/`MapTab`/`AiJobTab`/`PrintTab`/`CompaniesTab` 等都在组件内部 `const navigate = useNavigate()`，而非从 props 传入。搬到独立文件后必须保留 `import { useNavigate } from 'react-router-dom'`。`CampusPage`/`JobFairDetailPage` 主组件通过 props 把 `onBook/onNav/onGoTab` 等回调下传，这套 props 契约要原样保留。

### W-3. QrModal 在 Campus 与 JobFairDetail 中字符级相同，但分属两个允许目录
两份 `QrModal`（Campus 161-210 / JobFairDetail 98-145）确实一致。但本任务允许目录是分开的 `campus/components/*` 与 `job-fairs/components/*`，**没有**共同落点。建议**各目录各放一份** `QrModal.tsx`，不要为了 DRY 新建跨目录公共目录（超范围、且后续易漂移）。`FairCompanyDetailPage` 的 `QrOverlay`（75-115）措辞/样式不同，保持独立，勿与 QrModal 合并。

### W-4. 日期 helper 命名分叉，按页搬运勿统一改名
- Campus：`fmtDate/fmtTime/fmtSync/fmtDateBadge/fmtHeldTime`。
- JobFairDetail：`formatDateTime/formatSync`。
两套命名不同、实现细节不同（如 Campus 有 same-day 折叠逻辑）。搬到各自 `utils.ts` 时**保持原名原实现**，不要趁机统一命名/合并，否则输出字符串可能变化。

### W-5. 模块级常量与正则要随 helper 一起搬，避免闭包/引用断裂
`AVATAR_COLORS`+`avatarColor`、`INDUSTRY_LABEL`+`industryLabel`、`CAT_RULES`+`categoryOf`、`pad` 都是“常量+函数”成对。搬运必须成对，否则函数引用到未导出的模块常量会编译失败。`HALL_BLOCK_COLORS`/`FACILITY_META`（JobFairDetail 674-688）只被 `VenueGuideTab` 用，随它一起搬入组件文件最干净。

---

## 🟢 Info（推荐拆分方案 / 顺序 / 验收）

### 推荐提取清单（按文件，全部为“移动”而非“重写”）

**CampusPage.tsx (897 → 目标 ≤500)** — 新建 `campus/{types.ts,utils.ts,components/}`
| 落点 | 内容 | 约行 |
|---|---|---|
| `campus/utils.ts` | `pad,fmtDate,fmtTime,fmtSync,fmtDateBadge,fmtHeldTime,avatarColor,industryLabel,categoryOf,isCampusFair,campusScore` | ~110 |
| `campus/types.ts` | `STATUS_CONFIG,THEME_STAT_LABELS,AVATAR_COLORS,INDUSTRY_LABEL,CAT_RULES,TABS,TabKey,QrState` | ~50 |
| `campus/components/QrModal.tsx` | `QrModal` | ~50 |
| `campus/components/OverviewTab.tsx` | `OverviewTab,StatCell,QuickEntry,InfoRow` | ~180 |
| `campus/components/CompaniesTab.tsx` | `CompaniesTab` | ~130 |
| `campus/components/MapTab.tsx` | `MapTab` | ~65 |
| `campus/components/AiJobTab.tsx` | `AiJobTab,AiFeatureCard` | ~48 |
| `campus/components/PrintTab.tsx` | `PrintTab,PrintRow` | ~50 |
| **主文件保留** | 头部注释+精简 import + `CampusPage` 主体 | **~250** ✅ |

**JobFairDetailPage.tsx (857 → ≤500)** — 复用现有 `job-fairs/components/`，新建 `job-fairs/{types.ts,utils.ts}`
| 落点 | 内容 | 约行 |
|---|---|---|
| `job-fairs/utils.ts` | `pad,formatDateTime,formatSync,avatarColor,industryLabel,categoryOf` | ~50 |
| `job-fairs/types.ts` | `STATUS_CONFIG,AVATAR_COLORS,INDUSTRY_LABEL,CAT_RULES,TABS,TabKey,QrState` | ~45 |
| `job-fairs/components/QrModal.tsx` | `QrModal` | ~50 |
| `job-fairs/components/DetailsTab.tsx` | 本地 `MapBlock`(**保留 min-h**) + `DetailsTab` | ~180 |
| `job-fairs/components/CompaniesTab.tsx` | `CompaniesTab`（两栏版） | ~130 |
| `job-fairs/components/VenueGuideTab.tsx` | `VenueGuideTab,HALL_BLOCK_COLORS,FACILITY_META` | ~190 |
| **主文件保留** | 精简 import + `JobFairDetailPage` 主体 | **~250** ✅ |

**FairCompanyDetailPage.tsx (647 → ≤500)** — 新建 `job-fairs` 同目录组件（注意它在 `job-fairs/` 根，不在 campus）
| 落点 | 内容 | 约行 |
|---|---|---|
| `job-fairs/components/company-detail/` (或同目录) `FilterBar.tsx` | `FilterBar,Filters` | ~90 |
| `…/PositionViews.tsx` | `PositionListView,PositionPosterView,POSITION_TYPE_*,INDUSTRY_GRADIENT` | ~150 |
| `…/CompanyHeader.tsx` | `CoverArea,CompanyInfoCard,ActionBar,QrOverlay` | ~210 |
| `job-fairs/types.ts`(复用) | `ViewMode,PrintFile` | ~10 |
| **主文件保留** | import + `FairCompanyDetailPage` 主体 | **~190** ✅ |
> 只需搬出约 ≥150 行即达标；以上较激进，可按需少搬，确保主体 ≤500 即可。

### 实施顺序（每步后立即跑守卫 + tsc，单文件绿了再下一个）
1. **先 FairCompanyDetailPage**（647，最易、跨目录最少、无 STATUS_CONFIG/MapBlock 陷阱）→ 建立模式与信心。
2. **再 CampusPage**（独立目录、不与他页共享，风险隔离）。
3. **最后 JobFairDetailPage**（含 C-1 MapBlock 陷阱，留到最熟练时处理）。
4. 全绿后更新 `docs/progress/current-progress.md`、`next-tasks.md`，并在 `.ccg/tasks/jobfair-pages-size-split/` 记录。
> 每个页面**单独一个 commit**，便于 `git revert` 定位回归。遵守 feature 分支铁律（当前 `codex/jobfair-pages-size-split` 已是 feature 分支），禁止 `git add .`。

### 验收关注点
- `node apps/kiosk/scripts/verify-jobfair-page-size.mjs` → ALL PASS（三文件 ≤500）。
- `tsc --noEmit` / 项目 build 无未使用 import、无未定义引用（W-1）。
- `git diff` 审查：**新文件内容应与原片段逐行一致**（仅增 import/export 行）；主文件 diff 应只剩“删除被搬走的块 + 改为 import”。
- 逐项目视检查 C-4 清单：路由串、埋点事件名、合规文案、按钮文案、`PrintFile` 公式、二维码 value 源 **零变更**。
- 手动冒烟（竖屏 9:16）：Campus 5 Tab 切换、详情页 4 Tab + 底部“扫码预约/打印资料”、企业页 list/poster 切换与筛选、地图块在无图态仍保持 `min-h-[15rem]`（C-1 回归点）。
- 确认无新增业务功能、无路由表改动（`router` 配置文件不在允许修改清单内，应保持未触碰）。

---

按约束，本次仅做只读分析，未修改任何文件。需要我把上述方案细化成逐文件的 unified diff 补丁（仍不落盘，仅输出 patch）吗？

---
SESSION_ID: 1e8d7100-0b9b-459f-9f96-209e3c6115c6
