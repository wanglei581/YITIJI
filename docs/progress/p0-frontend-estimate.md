# P0 前端真实工程量评估(基于现状差分)

> 起草:2026-05-30 · 范围:Kiosk / Admin / Partner 三端 P0 模块  
> 输入:[miaoda-reference-catalog.md](../product/miaoda-reference-catalog.md) 的 S/M/L 估算 +  
> 现有代码逐文件检阅(`apps/kiosk/src/pages/**`、`apps/admin/src/routes/**`、`apps/partner/src/routes/**`)  
> 目标:把 catalog 抽象估算 → 落到"剩余多少小时、卡在哪、谁能并行"  
>
> 本文档为 Phase D 排期与人力分配的唯一依据。**catalog 的 M/L 标记保留只作参照,本表为准**。

---

## 1. 现状盘点表(P0 + 必经 P1)

完成度评级:**0%** = 仅文件占位 / **30%** = 列头+骨架表无数据 / **60%** = 有 mock 但缺真接口或关键组件 / **90%** = 接真 API 且体验可上线

| # | 模块 | 当前文件 | LOC | 完成度 | 当前阻塞点 |
|---|---|---|---|---|---|
| K1 | Kiosk 首页 | `kiosk/.../home/HomePage.tsx` | 245 | **70%** | 现行只有 2 主卡 + 2 次卡 + 人社栏,catalog 要求 7 一级模块 + 子入口;无子入口路由 |
| K2a | AI 简历上传/来源 | `resume/ResumeSourcePage.tsx` | 133 | **60%** | 缺四步引导 stepper、缺"如何使用"教程区,Mock file 写死 |
| K2b | AI 简历解析 | `resume/ResumeParsePage.tsx` | 203 | **80%** | 已接 `getResumeRecord`,UI 完整,差错误态打磨 |
| K2c | AI 简历诊断 | `resume/ResumeReportPage.tsx` | 209 | **65%** | **缺核心组件:5 维度评分条 + 能力雷达图(无 recharts)**;现行可能只展示文字 |
| K2d | AI 简历优化对比 | `resume/ResumeOptimizePage.tsx` | 180 | **55%** | **缺 before/after split view + diff 高亮**(无 react-diff-viewer);现仅模块列表 |
| K3 | Kiosk 招聘列表 | `jobs/JobsPage.tsx` | 153 | **85%** | 已接 `getJobs` + 来源/同步时间字段;**差顶部橙色合规横幅(catalog 要求 banner,现行仅小灰字)** + CTA 文案要换 "查看岗位 / 去来源平台投递" |
| P1 | Partner 工作台 | `partner/.../dashboard/index.tsx` | 208 | **75%** | 8 卡 + PendingReview + 同步表全做了;**差合规横幅** + 趋势折线图 + TOP5 + 终端状态行(catalog 推荐 D 方案) |
| P2 | Partner 岗位管理 | `partner/.../jobs/index.tsx` | 224 | **70%** | 列表 + 筛选 + 接真 API 完成;**缺批量 Excel 导入 UI**(后端 importJobs 已就绪)+ 数据表现列(浏览/跳转) |
| A1 | Admin 工作台 | `admin/.../dashboard/index.tsx` | 256 | **65%** | KPI/待办/告警三段做好但全 mock;catalog 要求 8 卡(现 4 卡)+ 今日收入/AI 调用次数/今日趋势折线 |
| A2 | Admin 终端管理 | `admin/.../devices/index.tsx` + `terminals/` `printers/` `peripherals/` | 60+175+220+12 | **55%** | 终端/打印机 tab 数据齐(mock),**外设 tab 纯 EmptyState**;碳粉余量字段、SN 字段已在 mock 里;全部未接 API |
| A3 | Admin 文件管理 ⭐合规 | `admin/.../files/index.tsx` | 267 | **70%** | UI 完整(筛选/敏感级别/清理状态/操作日志说明);**未接 API**,无"强制清理过期文件"红色顶 CTA(catalog 必备),无操作日志写库 |
| A4 | Admin 岗位信息源 ⭐合规 | `admin/.../job-sources/index.tsx` | 216 | **80%** | 接真 API(approve/publish/unpublish)+ 筛选 + 分页;**差顶部蓝色合规声明横幅**(catalog 标记为典范) |
| A5 | Admin 日志审计 ⭐合规 | `admin/.../audit/index.tsx` | 40 | **10%** | **纯骨架占位 6 行灰条**,无 mock 无 API 无搜索 |

---

## 2. 真实工作量重估表(精确到小时)

公式:**剩余工时 = UI 新增 + 接 API + 边界打磨**;不含后端实现(由后端组并行)。

| # | 模块 | catalog 估 | 真实重估 | 拆解 |
|---|---|---|---|---|
| K1 | Kiosk 首页 | M(1-2 天) | **6h** | 4h 改成 7 卡片墙 + 子入口 grid · 2h 子入口路由占位 + lucide icon 映射 |
| K2a | AI 简历来源 | M | **5h** | 3h 加 stepper(packages/ui 新建)+ "如何使用 4 步" 静态卡 · 2h 文件元数据真实化 |
| K2b | AI 简历解析 | — | **2h** | 1h 失败态、骨架 · 1h 重试链路打磨 |
| K2c | AI 简历诊断 | M | **14h** | **8h 写 `ResumeRadarChart`(recharts)+ 5 维度条** · 3h 优势/风险点数据接 API · 3h 评分计算与打印链路 |
| K2d | AI 简历优化对比 | M | **18h** | **10h 写 `ResumeBeforeAfterDiff`(react-diff-viewer 或自研)+ 折叠展开 + 4 维度提升进度条** · 4h 对接 streaming · 4h 边界(空 diff/失败重试) |
| K3 | Kiosk 招聘列表 | S | **4h** | 2h 加 `ComplianceBanner`(橙色,packages/ui 新建)· 1h 改 CTA 文案为 "查看岗位"/"去来源平台投递" · 1h 加 92% 匹配度 badge(展示个人侧) |
| P1 | Partner 工作台 | M | **8h** | 2h 加合规横幅 · 4h 趋势折线图 + 热门 TOP5(recharts)· 2h 终端绑定状态行 |
| P2 | Partner 岗位管理 | M | **10h** | 6h 批量 Excel 导入抽屉 + 字段映射预览(可调 sources/ 既有 wizard)· 2h 数据表现列(浏览/跳转,需后端接口)· 2h 二维码弹窗 |
| A1 | Admin 工作台 | M | **6h** | 2h 把 4 卡扩到 8(KPI 设计现成)· 3h 24h 折线图(recharts)· 1h 数据从 mock 切真 API |
| A2 | Admin 终端管理(三 tab) | M | **18h** | 4h 接终端真 API · 4h 接打印机真 API + 碳粉余量进度条 · **8h 外设管理整页**(6 类型卡 + 异常表) · 2h 详情抽屉 |
| A3 | Admin 文件管理 ⭐ | L | **20h** | 4h 顶部"强制清理"红色 CTA + 确认弹窗 · 6h 接文件 API + 自动清理 BullMQ 调度查询 · 6h 操作写审计日志 · 4h 详情抽屉(预览/下载链路、加密标记) |
| A4 | Admin 岗位信息源 ⭐ | M | **3h** | 2h 顶部蓝色合规声明横幅(`ComplianceBanner` 复用)· 1h 详情抽屉(来源链接、字段映射) |
| A5 | Admin 日志审计 ⭐ | M | **16h** | 4h 表格列(时间/操作人/模块/明细/IP/结果)+ mock · 4h 接 API + 分页 + 模块筛选 · 4h 详情抽屉(diff 前后) · 4h 全文检索 |

**P0 总工时**:**130h ≈ 17 人天**(单人)  
单前端 4 周可用工时 ≈ 4 周 × 5 天 × 6h = **120h**,**单人勉强压线;两人并行 < 2 周完成**。

> ⚠️ 注:工作量不含 K2(AI 简历)的后端 prompt 工程与模型对接。如果 LLM 链路未就绪,K2c/K2d 实际交付时间会被后端阻塞,需提前一周和后端组拉齐。

---

## 3. 可复用组件清单 & 新增组件

### 3.1 现有 `packages/ui` 已有(8 个)

`Button` / `Card` / `EmptyState` / `ErrorState` / `LoadingState` / `PageHeader` / `Spinner` / `StatusBadge` + 3 个 layout(`KioskLayout` / `AdminLayout` / `PartnerLayout`)。  
另有 `apps/admin/src/routes/components/DataTable` 内的 `Pagination + useTableState`,**应抽到 `packages/ui`**(Admin / Partner 都在用)。

### 3.2 P0 必须新建的共享组件(放 `packages/ui`)

| 组件 | 用于 | 备注 |
|---|---|---|
| `ComplianceBanner` | Kiosk 招聘列表 / Admin 岗位信息源 / Partner 工作台 | 三色变体(蓝声明 / 橙提示 / 红警告);**一次写多处用** |
| `Stepper` | Kiosk AI 简历四步流 | 横向步骤条,触控 ≥ 48px |
| `MetricCard` | Admin/Partner 工作台 | 现两端各写一遍;抽出来 |
| `Pagination` + `useTableState` | Admin/Partner 所有列表 | 已存在,从 admin/routes/components 抽到 packages/ui |
| `DataTable` 薄包装 | 所有后台表 | 列定义 + sticky header + 空态联动,简化 7+ 表 |
| `Drawer` | 各种"详情抽屉" | shadcn dialog 改造,右侧 480px |

### 3.3 P0 必须新建的"非 shadcn 能给"组件(单独建)

| 组件 | 用于 | 实现路径 |
|---|---|---|
| `ResumeRadarChart` | Kiosk 简历诊断 K2c | **recharts** `RadarChart` |
| `ResumeBeforeAfterDiff` | Kiosk 优化对比 K2d | **react-diff-viewer-continued** + 自定义折叠 |
| `TrendLineChart` | Admin/Partner 工作台 | recharts `LineChart` |
| `FunnelCard` | Partner 数据统计(P1) | recharts 无原生漏斗,自绘 SVG 或 `recharts-funnel` |
| `TonerLevelBar` | Admin 打印机管理 | 纯 div + 渐变;5 分钟可写 |

### 3.4 需引入的依赖

```
recharts                  # 雷达 / 折线 / 漏斗(Admin/Partner/Kiosk 共用)
react-diff-viewer-continued  # 简历前后对比(优于已弃维护的 react-diff-viewer)
qrcode.react              # P1 招聘会扫码预约、Partner 岗位扫码
@amap/amap-jsapi-loader   # P1 招聘会地图(P0 不需要)
```

---

## 4. 风险:catalog 估"M",实际是"L"的模块

按风险从高到低:

1. **K2d AI 简历优化对比 — catalog M(2-3 天) → 实际 L(18h)**  
   原因:不是普通 CRUD,**核心是 diff 算法 + before/after split view + 4 维度提升进度条 + AI streaming 逐项呈现**。`react-diff-viewer-continued` 只解决文本 diff,语义级"修改原因"标注需自研。**首次使用 streaming,UI 状态机复杂(idle/streaming/done/error/retry)**。

2. **A5 Admin 日志审计 — catalog M(2 天) → 实际 L(16h)**  
   原因:catalog 把日志审计写成"列表 + 分页",但 §11/§12 合规要求:**操作前后 diff、IP 追溯、跨模块检索、不可篡改提示**。现项目此页是纯占位,所有工作量都在新增侧。

3. **A3 Admin 文件管理 — catalog L,与本估 20h 一致,但隐藏风险**  
   原因:UI 看似 70% 完成,**实际隐藏在"自动清理 BullMQ 调度 + 操作写审计 + 强制清理高敏感操作的二次确认"**。若后端清理任务未就绪,前端只能展示静态状态,合规价值打折。

4. **A2 Admin 终端管理(外设 tab) — catalog M → 实际 L 的一半**  
   原因:终端 + 打印机 tab 现状 60%-70%,**外设 tab 完全空**(EmptyState 一行)。catalog 要求 6 类外设卡 + 异常表 + 重置按钮,要 8h 单写一页。

5. **K2c 简历诊断 — catalog M → 14h**  
   原因:**雷达图首次引入 recharts**,雷达图配色 + 5 维度 + 触控屏交互(hover 改 tap)需要单独打磨;现有 209 行只展示文字综合评分。

**与 catalog 估算一致或偏轻的模块**:K1 首页(6h)、K3 招聘列表(4h)、A4 岗位信息源(3h)、P1 工作台(8h)— 这些已有 60-85% 完成,差合规横幅、TOP5、图表锦上添花,**可一天一个产出**。

---

## 5. 并行作战建议(2 前端 + 1 后端)

**人员代号**:F1(前端 A,资深,负责复杂组件 + Kiosk)· F2(前端 B,负责 Admin/Partner)· B1(后端,API + 审计写库)。

### 周一 - 周二(并行 Day 1-2)

| 人 | 任务 | 输出 |
|---|---|---|
| F1 | `packages/ui` 抽 `ComplianceBanner` + `Stepper` + `MetricCard` + `Drawer` + 把 Pagination 上提 | 5 个共享组件,**所有后续工作的前置** |
| F2 | K1 首页(6h)+ K3 招聘列表(4h)+ A4 岗位信息源加合规横幅(3h) | 3 个低风险模块一次性收掉,**早期出可演示成果** |
| B1 | 文件 API + 审计日志写库表 + 终端/打印机/外设上报 API | 前端解锁 A2/A3/A5 |

### 周三 - 周五(Day 3-5)

| 人 | 任务 |
|---|---|
| F1 | K2c 简历诊断(14h):recharts 雷达图 + 5 维度条 → 周三晚出 demo |
| F1 | K2d 简历优化对比(18h)启动:diff 组件骨架 + before/after split |
| F2 | A1 Admin 工作台扩 8 卡 + 趋势(6h)+ P1 Partner 工作台扩(8h) |
| F2 | A2 终端管理接 B1 API(8h)+ 外设页(8h) |

### 第 2 周

| 人 | 任务 |
|---|---|
| F1 | K2d 完成 + K2a/K2b 引导收尾(8h)+ Kiosk 联调 |
| F2 | A3 文件管理强制清理 CTA + 审计写入(8h)+ A5 日志审计整页(16h) |
| F2 | P2 Partner 岗位 Excel 导入抽屉(10h) |

### 第 3-4 周

留作:**联调、Bug 修复、Kiosk 触控真机回归(必须在 21.5 寸真机过一遍)、合规文案二审**。  
**3-4 周给出缓冲**就是为了"K2d 实际是 L"、"A5 日志审计是 L" 这两个风险点超时不挤垮交付。

### 不能并行 / 必须串行

- `ComplianceBanner` 必须先于 K3 / A4 / P1
- `Pagination` 抽上提必须先于 P2 / A5(否则改两次)
- A3 / A5 必须等 B1 的"审计日志写库"接口,不然合规价值打折

---

## 6. shadcn/ui 不够用的地方(必须自建)

shadcn/ui 强项是表单 / dialog / tabs / dropdown 等"操作型组件"。**数据可视化、可触摸大尺寸控件、合规专属控件都需要自建**:

| 类型 | shadcn 是否提供 | 我们的处理 |
|---|---|---|
| 雷达图 | ❌ | recharts `RadarChart`,新建 `ResumeRadarChart` |
| 折线/柱状 | ❌ | recharts,新建 `TrendLineChart` |
| 漏斗图 | ❌ | recharts 无,**自绘 SVG**(`FunnelCard`) |
| diff 视图 | ❌ | `react-diff-viewer-continued`,封装 `ResumeBeforeAfterDiff` |
| 二维码 | ❌ | `qrcode.react`,Kiosk 招聘会 / Partner 岗位扫码用 |
| 地图嵌入 | ❌ | 高德 JSAPI / iframe,**P0 不需要,P1 招聘会再说** |
| 合规横幅 | ❌ | 自建 `ComplianceBanner`(3 色变体) |
| Stepper | ❌ | 自建,触控 ≥ 48px |
| 触控大按钮(≥56px) | shadcn `Button` size="lg" 不够大 | **`packages/ui/Button` 加 `size="kiosk"` 变体**(h-16,触控 ≥ 56px),不要每个页面自己写 |
| 抽屉(右侧 480px) | shadcn `Sheet` 可用 | **薄封装为 `Drawer`** + 统一头部/底部/loading |
| 数据表分页 | ❌ | 已有 `Pagination`,上提到 `packages/ui` |

**结论**:packages/ui 共需 **5 个基础组件 + 4 个图表组件 + 1 个 diff 组件 + 1 个 Button 变体** = **11 处新增**,占 P0 工时约 30h(分摊在 F1 的前两天 + 各模块内)。

---

## 7. 行动项清单

- [ ] F1 立即上提:`Pagination`、`MetricCard`、`Stepper`、`ComplianceBanner`、`Drawer` 到 `packages/ui`
- [ ] F1 立即写:`ResumeRadarChart`、`ResumeBeforeAfterDiff`、`TrendLineChart`
- [ ] F2 立即收:K1 首页 → K3 招聘列表 → A4 岗位信息源加横幅,3 天连出
- [ ] B1 第一周必须交付:文件 API + 审计日志写库 + 终端/打印机/外设上报 API
- [ ] 引入依赖:`recharts`、`react-diff-viewer-continued`、`qrcode.react`
- [ ] 第三周末做一次"合规文案二审":CTA 文案、合规横幅出现位置、Kiosk 不能出现后台入口
- [ ] 第四周必须在 21.5 寸真机做触控回归
