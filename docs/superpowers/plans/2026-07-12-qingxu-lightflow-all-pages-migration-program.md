# 青序 LightFlow 三端全页面迁移总计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变既有业务入口、API、权限、状态机和合规边界的前提下，把青序 LightFlow 从三个代表页逐步扩展到 Kiosk、Admin、Partner 的 112 个正式页面组件，并以真实状态、错误恢复和分级证据完成商用 UX 收口。

**Architecture:** 产品与设计体系名称统一为「青序 LightFlow」，工程内部继续使用 `service-desk` 主题作用域。迁移采用 UI-0 共享基础、UI-1 三个代表页、UI-2 十三个业务域波次、UI-3 跨页面边界收口、UI-4 旧主题退出五层结构；每个波次独立计划、独立 worktree、独立验证、独立提交和独立回滚。

**Tech Stack:** React、Vite、TypeScript、Tailwind CSS、`@ai-job-print/ui`、React Router、现有静态 verify、Playwright / Codex in-app Browser、真实 HTTP API。

---

## 0. 计划性质与执行边界

本文件是全页面迁移的主控计划，不直接授权一次性修改 112 个页面。它负责固定顺序、波次、准入、证据和停止条件；每个 UI-2 波次在开工前必须从当时最新 `main` 生成单独的逐文件实施计划。

全页面事实清单见：

- `docs/reviews/qingxu-lightflow-page-inventory-2026-07-12.md`

第一批逐文件实施计划继续使用：

- `docs/superpowers/plans/2026-07-11-service-desk-ui0-ui1-first-batch.md`

### 全程禁止

- 不新增或恢复重复路由、首页入口、底部 Tab、后台菜单和同义卡片。
- 不把 4188 的演示登录、假数据、原型弹窗或本地状态带入正式代码。
- 不在视觉任务中修改 API、DTO、Prisma、权限、认证、支付、打印、扫描、AI、TRTC 或 Terminal Agent 逻辑。
- 不把 Kiosk 大卡片直接复制到后台，也不把后台表格压入 Kiosk。
- 不在 UI-0 至 UI-3 期间全仓删除旧主题。
- 不把本地截图、真实账号、token、付款码、个人简历或网络日志提交到 Git。

## 1. 波次总览

| 层级 | 波次 | 页面范围 | 开工前置 |
| --- | --- | --- | --- |
| UI-0 | 共享基础 | token、三种密度、三端壳层合同 | 最新 main 干净基线 |
| UI-1 | K0 / A0 / P0 | Kiosk 首页、Admin 工作台、Partner 岗位管理 | UI-0 通过 |
| UI-2 | K1–K6 | Kiosk 其余 69 个页面组件 | UI-1 用户视觉验收通过 |
| UI-2 | A1–A4 | Admin 其余 28 个页面组件 | A0 密度与真实数据验证通过 |
| UI-2 | P1–P3 | Partner 其余 12 个页面组件 | P0 机构隔离与工作流验证通过 |
| UI-3 | E1 | 跨页面边界状态与可访问性收口 | 13 个 UI-2 波次完成 |
| UI-4 | X1 | 旧主题退出与商用终验 | 无旧主题运行时引用证据 |

## 2. 通用单波次合同

每个 UI-2 波次必须遵守同一执行模板。

### 2.1 开工基线

- [ ] **Step 1: 从最新 `origin/main` 创建独立 worktree**

Run:

```bash
git fetch origin main
git worktree add .worktrees/<wave-name> -b codex/<wave-name> origin/main
git -C .worktrees/<wave-name> status --short --branch
```

Expected: 新 worktree 干净，分支只承载一个波次；不得从落后主线的旧 UI 分支直接续写。

- [ ] **Step 2: 核对路由与文件预算**

Run:

```bash
git grep -n "path:" -- apps/kiosk/src/routes/index.tsx apps/admin/src/routes/index.tsx apps/partner/src/routes/index.tsx
wc -l <本波次所有目标页面与样式文件>
```

Expected: 路由与页面盘点一致；500 行以上文件写明拆分决定，800 行以上文件先拆分再换装。

- [ ] **Step 3: 运行本波次既有功能基线**

Run 至少包含对应端：

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/partner typecheck
```

Expected: 目标端基线可验证；若存在与本波次无关的失败，记录精确命令、错误与来源后停止，不带病写视觉代码。

### 2.2 TDD 与文件范围

- [ ] **Step 4: 先写本波次静态 verify 并得到 RED**

每个 verify 必须锁定：

- 允许迁移的精确路由与页面文件；
- `service-desk` 只在目标路由启用；
- 入口、真实 API、权限、加载、空态、错误、重试和合规文案未丢失；
- 禁止重新引入 InkPaper / Fusion Youth 视觉值；
- 触控、焦点、reduced motion、响应式和长内容门禁；
- 禁止出现假成功、假支付、假打印、假 AI、假来源或平台投递文案。

Expected: 因目标页面尚未迁移而失败，失败原因必须指向该波次的视觉合同，而不是现有业务行为。

- [ ] **Step 5: 只修改本波次计划列出的文件并取得 GREEN**

Expected: 页面行为 diff 限于视觉作用域、语义 class、布局拆分和可访问性修复；API 调用、参数、权限、状态机和路由保持不变。

- [ ] **Step 6: 单波次提交**

Run:

```bash
git diff --check
git diff --stat
git add <本波次精确文件清单>
git commit -m "feat(<surface>): migrate <domain> to qingxu lightflow"
```

Expected: 不使用 `git add .`；提交可独立回滚。

### 2.3 浏览器与证据

- [ ] **Step 7: 浏览器实点目标流程**

Kiosk 固定视口：1080×1920、390×844、390×700。
Admin / Partner 固定视口：1440×1024、1280×800、1024×768。

每个页面至少验证：首屏、加载、真实数据、空态、错误与重试、主操作、返回路径、键盘焦点、长标题、长列表、权限 / 禁用状态和 reduced motion。

- [ ] **Step 8: 记录 UX 等级**

- 只有静态与构建证据：UX-1。
- 本地真实 HTTP API、角色登录和浏览器闭环：UX-2。
- 预生产真实服务、权限和可恢复状态：UX-3。
- Windows 真机、奔图硬件或真实支付证据：UX-4。

不得用 UX-1 / UX-2 证据宣称 UX-3 / UX-4。

## 3. UI-0/UI-1 第一批

### Task 0: 执行共享基础与三个代表页计划

**Plan:** `docs/superpowers/plans/2026-07-11-service-desk-ui0-ui1-first-batch.md`

- [ ] **Step 1: 执行 Batch A UI-0 共享基础**
- [ ] **Step 2: 执行 Batch B Kiosk 首页**
- [ ] **Step 3: 执行 Batch C Admin 工作台**
- [ ] **Step 4: 执行 Batch D Partner 岗位管理**
- [ ] **Step 5: 完成真实 HTTP 浏览器矩阵和全部工程门禁**
- [ ] **Step 6: 用户审阅三个代表页并明确批准进入 UI-2**

停止条件：任何一个代表页不能覆盖其端的密度、状态和真实流程时，先修正 UI-0/UI-1，不允许把问题复制到其余页面。

## 4. UI-2 Kiosk 六个业务波次

### Task 1: K1 公共入口、身份与独立全屏页

**Routes:** `/login`、`/member/qr-login`、`/upload/phone`、`/legal/:doc`、`/screensaver`、`/help`。

重点合同：共享设备隐私、登录失败、二维码过期、手机上传中断、法律文档可读性、待机退出和安全返回。

停止条件：不得把登录、上传或会话清理逻辑混入视觉任务；`LoginPage.tsx` 697 行，实施计划必须先决定无行为拆分。

### Task 2: K2 AI 助手、简历与面试

**Routes:** `/assistant`、两条职业方向页、九条简历页、五条面试页，完整清单以页面盘点 K2 为准。

重点合同：真实 AI 状态、流式中断、用户事实确认、撤回与重试、会话清场、语音降级、导出 / 打印入口真实性。

停止条件：不得修改模型、prompt、TRTC、上传、打印 URL 或记录持久化；`InterviewSessionPage.tsx`、`ResumeOptimizePage.tsx`、`AssistantPage.tsx` 需先评估拆分。

### Task 3: K3 打印、扫描与文件处理

**Routes:** 三条打印扫描服务页、七条打印流程页、四条扫描流程页。

重点合同：文件状态、价格、支付、设备、打印任务、失败恢复、重试防重复、终态真实性和本机能力边界。

停止条件：该波次涉及高风险真实链路，只能改变视觉与信息结构；`PrintMaterialCheckPage.tsx` 891 行必须先无行为拆分，真实支付或硬件变更另立任务。

### Task 4: K4 本人资产、活动与设置

**Routes:** `/profile`、十条 `/me/*`、两条活动页。

重点合同：游客 / 登录态、本人数据、空态、过期、删除、继续任务、退出清场和隐私脱敏。

停止条件：当前“我的页商用闭环第一批”任务完成、迁移或明确废弃前不得开工；新基线必须重新读取该任务最终提交。

### Task 5: K5 岗位、企业与招聘会

**Routes:** 两条岗位页、两条企业页、九条招聘会与现场服务页。

重点合同：第三方 / 官方来源、外部跳转、无平台投递、场次状态、资料可用性、地图 / 计划 / 统计真实性。

停止条件：不得新增投递、预约、候选人、企业招聘闭环；来源与发布状态不能被分类色替代。

### Task 6: K6 政策、校园与终端配置能力

**Routes:** `/renshi`、`/campus`、四条智慧校园页。

重点合同：政策来源、地区适用范围、内置指引边界、学校 / 终端配置、未配置和无权限状态。

停止条件：不得把内置指引冒充官方政策，不得恢复虚构材料包、预约或代办能力。

## 5. UI-2 Admin 四个业务波次

### Task 7: A1 身份、权限、设备与异常处理

**Routes:** `/login`、`/devices`、`/alerts`、`/permissions`、`/audit`。

重点合同：环境与账号身份、菜单权限、设备状态分层、告警证据、审计编号和返回焦点。

停止条件：三个历史设备路径继续重定向 `/devices`，不得恢复重复页面；Admin 登录页 727 行须先决定拆分。

### Task 8: A2 交易、文件与终端运营

**Routes:** `/orders`、`/print-scan`、`/billing`、`/files`、`/job-materials`、`/screensaver`、`/toolbox`。

重点合同：支付与订单分离、打印 / 扫描状态、文件保留、批量结果、终端作用范围和危险操作确认。

停止条件：不得把未知金额显示为 0，不得用 Toast 替代批量结果；`print-scan` 与 `screensaver` 大文件先评估拆分。

### Task 9: A3 AI 配置、内容来源与机构治理

**Routes:** `/ai-services`、`/ai-config`、三个来源页、`/fairs`、`/companies`、`/partners`、`/import-batches`、`/sync-sources`。

重点合同：来源审核与发布分离、凭证不回显、机构范围、部分导入失败、同步计划和审计。

停止条件：`apps/admin/src/routes/partners/index.tsx` 817 行必须先拆分；不得通过视觉任务改变审核或发布状态机。

### Task 10: A4 会员、活动与智慧校园

**Routes:** `/users`、`/benefit-activities`、`/member-benefits`、`/member-feedback`、`/member-notifications`、`/smart-campus`。

重点合同：会员身份、权益记录、活动发布、反馈处理、通知范围、终端 / 学校作用域。

停止条件：敏感字段继续最小显示；批量通知、权益和活动操作必须显示对象数量与影响范围。

## 6. UI-2 Partner 三个业务波次

### Task 11: P1 身份、机构与账号

**Routes:** `/login`、`/`、`/profile`、`/account`。

重点合同：机构名称、角色、数据范围、账号状态、退出和无权限。

停止条件：Partner 登录页 727 行须先决定拆分；不得显示 Admin 权限后再前端置灰。

### Task 12: P2 机构内容工作流

**Routes:** `/companies`、`/fairs`、`/policy`、`/smart-campus`。

重点合同：草稿、审核、发布、下架、驳回修正、重新提交和本机构范围。

停止条件：不得引入候选人、简历、面试邀约或 Offer 能力；机构内容状态不得折叠为一个成功徽章。

### Task 13: P3 终端、统计与数据源

**Routes:** `/terminals`、`/stats`、`/sources`、`/sync-logs`。

重点合同：终端归属、统计口径、Excel / API / Webhook 来源、凭证状态、部分同步失败和下一次计划时间。

停止条件：凭证明文不得进入 DOM、日志、截图或文档；部分成功必须显示成功、跳过、失败数量和恢复动作。

## 7. UI-3 跨页面边界收口

### Task 14: E1 状态、可访问性与恢复一致性

**Files:** 只修改 UI-2 已迁移页面及 `packages/ui` 已批准的共享组件；不得借机触碰未迁移业务。

- [ ] **Step 1: 对 112 个页面执行状态矩阵审计**
- [ ] **Step 2: 对三端执行键盘、焦点、触控与 reduced motion 审计**
- [ ] **Step 3: 对长标题、长 ID、长 URL、50 / 100 行数据和空筛选执行边界数据审计**
- [ ] **Step 4: 对登录过期、离线、超时、部分失败、返回位置和输入保留执行恢复审计**
- [ ] **Step 5: 修复必须按端和业务域拆成小提交，复跑对应 UI-2 波次门禁**

Expected: 同一状态在三端语义一致，密度和操作方式按角色不同；不存在只靠颜色、只靠 Toast 或无法恢复的关键状态。

## 8. UI-4 旧主题退出与商用终验

### Task 15: X1 删除旧主题的证据门禁

- [ ] **Step 1: 证明三端所有正式路由均已显式使用青序作用域**
- [ ] **Step 2: 证明无路由、import、verify、文档或部署仍依赖 InkPaper / Fusion Youth**
- [ ] **Step 3: 单独制定旧 CSS 删除计划并执行全量 typecheck、lint、build、verify**
- [ ] **Step 4: 在 Kiosk 1080×1920、Admin / Partner 1440×1024 完成全路由视觉回归**
- [ ] **Step 5: 将 UX-1 至 UX-4 证据分层写入进度 SSOT**

Expected: 旧主题删除是独立、可审查的清理任务；未取得预生产、真机或真实支付证据的页面不得标记为 UX-3 / UX-4。

## 9. 全项目完成判定

只有同时满足以下条件，才能报告“青序 LightFlow 全页面迁移完成”：

- 112 个页面全部归入已完成波次，没有漏页和长期双主题页面。
- 5 个兼容重定向仍保持重定向，不出现重复页面。
- 三端壳层、密度、状态语义、品牌与工程命名一致。
- 入口、路由、API、权限、业务状态机和合规边界未被视觉迁移改变。
- 每个波次具有 RED / GREEN verify、typecheck、lint、build 和浏览器证据。
- 公共终端隐私、后台运营效率、Partner 机构隔离和错误恢复通过。
- 旧主题仅在无引用证据充分后删除。
- 真实环境等级按证据报告，没有把本地完成冒充生产或真机完成。

## 10. 当前执行停点

本计划完成后，下一步只允许执行 UI-0/UI-1 第一批。十三个 UI-2 波次必须等三个代表页通过用户验收后，按 Kiosk、Admin、Partner 分别生成逐文件实施计划并再次取得批准。
