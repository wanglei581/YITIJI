# Phase A · IA 决策可执行清单（2026-07-03）

> **本文档内容 100% 提炼自 [ia-consolidation-audit-2026-07-03.md](./ia-consolidation-audit-2026-07-03.md)，不重新扩范围、不新增未在该审计文档出现过的文件路径或结论。**
> 本文档仍是 **Phase A：只做文档**。不动 `apps/` / `services/` / `packages/` 运行时代码，不解冻 UI，不新增功能，不 git add，不提交。
> 用途：作为「是否进入代码真实化」的最终审阅底稿；用户确认后，Phase C/D 才会另起干净 `main` 分支 / 独立 worktree 逐条按本清单执行。

---

## 如何读这份清单

每个决策项固定六个字段：

- **决策项**：要处置的功能/页面
- **当前入口 / 页面**：路由或文件位置（引自审计文档）
- **最终动作**：保留 / 合并 / 隐藏 / 禁用 / 待真机 / 后续商业化（六选一或明确组合）
- **未来真实化允许修改哪些文件**：仅列审计文档中出现过的文件路径；审计文档未定位到具体文件/行号的，如实标注「需真实化前另行定位」，不在本清单猜测或新增路径
- **禁止事项**：来自审计文档 §0 边界 + 对应裁定原文
- **验证方式**：人工核对为主；本清单不新增/指定 verify 脚本，真实化任务如需防回退门禁由该任务自行设计

---

## 一、Kiosk

### 1. 岗位大师 → 合并 ✅ 2026-07-11 已执行
- **当前入口/页面**：首页占位卡（对应审计 §2.1；文件为 `apps/kiosk/src/pages/home/HomePage.tsx`，审计文档未给出具体行号）
- **最终动作**：**合并** —— 点亮时复用既有「岗位匹配参考」（2D）能力，不新增同义入口
- **允许修改文件**：`apps/kiosk/src/pages/home/HomePage.tsx`（首页卡片区；具体行号需真实化前另行定位）
- **禁止事项**：不新增「目标岗位分析」等同义卡片；不新建独立路由承接同一能力（审计 §3⑧ + matrix 入口稳定规则）
- **验证方式**：人工核对点亮后跳转目标为既有岗位匹配参考路由，未新增路由/卡片
- **2026-07-11 执行记录**：用户已就 `feature/job-master`（独立 M1/M1.5 实现，PR #117）与本条"合并复用"路线的冲突拍板选择本条；`HomePage.tsx` 的「岗位大师」磁贴已点亮并指向既有岗位匹配参考入口，未新增路由/组件；job-master 分支降级为素材参考，见 `docs/reviews/home-entry-closure-plan-2026-07-11.md`。

### 2. 打印扫描能力口径统一 → 合并（跨页规则）
- **当前入口/页面**：首页打印分组卡 `apps/kiosk/src/pages/home/HomePage.tsx`；服务中心 `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`；能力上限来源 `docs/progress/next-tasks.md`（P0 打印扫描首期「首期服务中心与能力开关」章节，只读参考不可修改）
- **最终动作**：**合并**（统一命名与数量，两处清单收敛为一套，以 next-tasks 首期清单为能力上限）
- **允许修改文件**：`apps/kiosk/src/pages/home/HomePage.tsx`（打印分组卡）、`apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`（服务中心）；审计文档未记录其余打印子页面文件路径，需真实化前另行定位
- **禁止事项**：不新增第二套打印入口；每项能力显隐必须由 FeatureGate/DeviceCapability/Admin 配置控制（审计 §3②），不得静态硬编码显示未验收能力
- **验证方式**：人工核对首页打印卡子项名称/数量与 `/print-scan` 服务中心一致，且与 next-tasks 首期清单一一对应

### 3. 纸质/材料扫描 → 待真机（**2026-07-11 更正：底层结论已过期**）
- **当前入口/页面**：`apps/kiosk/src/pages/scan/ScanStartPage.tsx`（`/scan/start`）
- **原最终动作（已过期）**：~~待真机——真机验收前保持「流程演示」诚实标注，不产出真实 FileObject，不进「我的」~~
- **2026-07-11 更正**：`feature/real-scan` 已于 2026-07-10 完成全部 21 个任务并合并进 `main`，新增 `ScanTask` 模型 + Agent 端 `scan-watcher.ts`（SMB 共享目录监听）+ Kiosk 四页面全部接真，**不再是流程演示**，`ScanResultPage` 的 `file` 状态只能来自真实 `getScanSessionStatus()`。本条"禁止移除演示标注"等约束已随代码真实化自然失效，仅剩 Windows 真机物理验收（真实打印机→SMB→Agent 端到端硬件链路）未完成，详见 `docs/progress/current-progress.md` 2026-07-10 对应条目。
- **验证方式**：待 Windows 真机验收清单排期后执行；当前仅需人工核对 `main` 上 `ScanTask`/`scan-watcher.ts`/四页面代码与 verify 断言仍在（不倒退回 mock）

### 4. 证件复印/证件照/~~云打印~~/格式转换/签名盖章/U盘 → 待真机（诚实禁用/隐藏）

> **2026-07-12 更新**：本条中的「云打印」已按正式取舍决策（用户拍板 D1=b）从首页删除，不再属于"待真机占位"——其已实现语义归位「文档打印+手机扫码上传」，真增量方向「远程提交·到店取件」记入商用二期候选，见 `docs/reviews/2026-07-12-cloud-print-decision.md`。另按同日核查更正：「格式转换」已于 2026-07-11 点亮图片→PDF MVP、「U盘」已于 2026-07-11 在 PrintUploadPage `usb` tab 代码级接线（均仅待真机/生产验收，见 matrix §3.4 与 next-tasks 对应条目），不再是纯占位；证件复印/证件照/签名盖章维持占位不变。

- **当前入口/页面**：首页占位卡 + `/print-scan`（审计文档未给出各子项具体文件路径，仅笼统定位在 `apps/kiosk/src/pages/home/HomePage.tsx` 与 `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx` 内）
- **最终动作**：**待真机**——真机/生产链路验收前，只允许诚实禁用或隐藏，二选一由真实化任务实施时决定，本清单不预先指定
- **允许修改文件**：`apps/kiosk/src/pages/home/HomePage.tsx`、`apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`；各子项对应具体组件文件审计文档未记录，需真实化前另行定位
- **禁止事项**：不得在真机验收前展示为「已完成」或产出假打印/假文件结果（审计 §3⑤）
- **验证方式**：人工核对各子项在未验收状态下为禁用态或不可见，不产生真实任务记录

### 5. 求职打印套餐 / AI服务套餐 / 招聘会扫码凭证 → 隐藏或禁用
- **当前入口/页面**：「我的」建设中入口，`apps/kiosk/src/pages/profile/ProfilePage.tsx`
- **最终动作**：**隐藏或禁用**（套餐/支付/凭证域本批不做）
- **允许修改文件**：`apps/kiosk/src/pages/profile/ProfilePage.tsx`
- **禁止事项**：不得补假闭环、不得展示假额度/假凭证（审计 §3④）
- **验证方式**：人工核对该入口在「我的」页保持隐藏或明确禁用态，无任何模拟数据

### 6. 智慧校园子页面（迎新服务 / VR校园）→ 待真机（子页真实化前保持禁用；入口门控无需改）
- **当前入口/页面**：`/smart-campus/*`（审计文档未记录子页面具体组件文件路径）；入口门控文件为 `apps/kiosk/src/pages/home/HomePage.tsx`（智慧校园 Section）+ `apps/kiosk/src/hooks/useSmartCampusConfig.ts`
- **最终动作**：**待真机/待真实化**——子页内容真实化前保持禁用；入口门控逻辑（默认 OFF、fail-closed、未授权不渲染）**无需修改**
- **允许修改文件**：入口门控文件（`HomePage.tsx`、`useSmartCampusConfig.ts`）**不在本项改动范围**（已符合裁定，见第 15 项「无需处置」）；子页面内容文件审计文档未记录，需真实化前另行定位
- **禁止事项**：不得在子页面未真实化前展示示例内容；不得修改现有 fail-closed 门控逻辑使其默认开启（审计 §1⑦、§1.1）
- **验证方式**：人工核对未授权终端首页智慧校园整块不渲染；已授权终端子页在未真实化前仍为诚实占位

### 7. 「我的」常用服务与入口 → 保留（冻结扩张）
- **当前入口/页面**：`apps/kiosk/src/pages/profile/ProfilePage.tsx`
- **最终动作**：**保留**——「我的」只做入口+概览+本次记录，「常用服务」≤少量快捷入口，不再新增
- **允许修改文件**：`apps/kiosk/src/pages/profile/ProfilePage.tsx`（仅限接真数据/修复现有入口，不得新增入口结构）
- **禁止事项**：不得新增服务类快捷卡片；不得重新渲染 `AccountAssetsPanel` 或任何「账号资产/资产中心」聚合区（审计 §3①，matrix 2026-06-14 整改硬约束）
- **验证方式**：人工核对「我的」页常用服务数量与当前一致，未新增卡片；未出现资产聚合区组件

### 8. AI助手会话落库 → 后续商业化（不属本轮上线收口）
- **当前入口/页面**：`/assistant`（matrix §3.7，本审计文档未列具体文件路径）
- **最终动作**：**后续商业化**——列 P2，需先做隐私先行设计（TTL/脱敏/本人可删）再建模，不在本轮/Phase A-D 范围内
- **允许修改文件**：不适用（非本 Phase 执行范围）
- **禁止事项**：不得在隐私设计完成前新增会话持久化模型或展示假历史记录
- **验证方式**：不适用（后续独立任务自行定义验收）

---

## 二、Admin

### 9. 用户管理 → 隐藏或保留禁用
- **当前入口/页面**：`apps/admin/src/routes/users/index.tsx`（Admin 侧栏「机构用户」分组）
- **最终动作**：**隐藏或保留禁用**（15 行纯 EmptyState「功能建设中」，2026-07-03 复核修正并入）
- **允许修改文件**：`apps/admin/src/routes/users/index.tsx`
- **禁止事项**：不得补充假用户列表数据充当「已完成」（审计 §1.1 A、§3⑥）
- **验证方式**：人工核对侧栏该项处于隐藏或点击后仍为诚实 EmptyState

### 10. 权限管理 → 隐藏或保留禁用
- **当前入口/页面**：`apps/admin/src/routes/permissions/index.tsx`（Admin 侧栏「系统管理」分组）
- **最终动作**：**隐藏或保留禁用**（整页 EmptyState「功能建设中，上线前暂不开放」）
- **允许修改文件**：`apps/admin/src/routes/permissions/index.tsx`
- **禁止事项**：不得补假角色/权限数据充当已完成能力（审计 §1、§3⑥）
- **验证方式**：人工核对侧栏该项处于隐藏或点击后仍为诚实 EmptyState

---

## 三、Partner

> 注：审计文档对以下三页统一以 `apps/partner/src/routes/{terminals,stats,account}/index.tsx` 合并列出证据路径，未逐一拆开写。本清单第 11–13 项按页面分开执行，但「允许修改文件」字段仍照审计文档原始合并写法引用，不展开为独立字符串，避免产生审计文档未出现过的新路径表述。

### 11. 终端数据 → 隐藏或保留禁用
- **当前入口/页面**：Partner 侧栏「数据与账号」分组·终端数据（审计文档合并证据路径 `apps/partner/src/routes/{terminals,stats,account}/index.tsx` 之一）
- **最终动作**：**隐藏或保留禁用**（建设中「敬请期待」）
- **允许修改文件**：`apps/partner/src/routes/{terminals,stats,account}/index.tsx`（审计文档原始合并写法，此项对应 `terminals`）
- **禁止事项**：不得补假终端数据充当已完成能力（审计 §2.3、§3⑥）
- **验证方式**：人工核对侧栏该项处于隐藏或点击后仍为诚实占位

### 12. 数据统计 → 隐藏或保留禁用
- **当前入口/页面**：Partner 侧栏「数据与账号」分组·数据统计（审计文档合并证据路径 `apps/partner/src/routes/{terminals,stats,account}/index.tsx` 之一）
- **最终动作**：**隐藏或保留禁用**（建设中「敬请期待」）
- **允许修改文件**：`apps/partner/src/routes/{terminals,stats,account}/index.tsx`（审计文档原始合并写法，此项对应 `stats`）
- **禁止事项**：不得补假统计图表/数字充当已完成能力（审计 §2.3、§3⑥）
- **验证方式**：人工核对侧栏该项处于隐藏或点击后仍为诚实占位

### 13. 账号权限 → 隐藏或保留禁用
- **当前入口/页面**：Partner 侧栏「数据与账号」分组·账号权限（审计文档合并证据路径 `apps/partner/src/routes/{terminals,stats,account}/index.tsx` 之一）
- **最终动作**：**隐藏或保留禁用**（建设中「敬请期待」）
- **允许修改文件**：`apps/partner/src/routes/{terminals,stats,account}/index.tsx`（审计文档原始合并写法，此项对应 `account`）
- **禁止事项**：不得补假权限配置项充当已完成能力（审计 §2.3、§3⑥）
- **验证方式**：人工核对侧栏该项处于隐藏或点击后仍为诚实占位

### 14. 智慧校园 → 拆分处理（不整页隐藏）
- **当前入口/页面**：`apps/partner/src/routes/smart-campus/index.tsx`（Partner 侧栏「校园服务」分组）
- **最终动作**：**拆分**（同一文件内三段式分别处理，2026-07-03 复核修正）：
  - 终端开关 Tab（`TerminalsPanel`，文件内约 L128-258）→ **保留**（真闭环：`saveSmartCampusConfig` 按 orgId 隔离、写审计、联动 Kiosk 首页显隐）
  - 迎新内容 / 使用统计 Tab（`OrientationPanel`/`UsagePanel`，约 L260-288）→ **保留**（维持诚实「未开放」空态，不展示任何示例数据）
  - 校园大数据（`toggle()` 函数 L154-155 对 `key==='bigdata'` 直接 `return`）→ **保留**（继续强制冻结，机构端不可开启）
- **允许修改文件**：`apps/partner/src/routes/smart-campus/index.tsx`（仅限对应 Tab 内接真数据/修复现有逻辑，不得改变三段式的显隐/冻结结构）
- **禁止事项**：不得整页隐藏或禁用（会误伤已真实联动 Kiosk 的终端开关）；不得给迎新内容/使用统计展示示例或假数据；不得解除校园大数据的强制冻结（审计 §1.1 B、§3⑥b）
- **验证方式**：人工核对三个 Tab 分别符合上述状态：终端开关可正常保存并在约 5 分钟内联动 Kiosk 首页显隐；迎新内容/使用统计展示「未开放」文案且无示例数据；校园大数据开关保持 disabled

---

## 四、无需处置（撤销原结论，仅记录不执行）

### 15. Kiosk 首页智慧校园入口门控
- **当前入口/页面**：`apps/kiosk/src/pages/home/HomePage.tsx:577-620`（`SmartCampusSection`）+ `apps/kiosk/src/hooks/useSmartCampusConfig.ts:7-52`
- **最终动作**：**无需处置**——已受 `useSmartCampusConfig` 控制，默认 OFF、fail-closed、无 terminalId/网络失败/未授权时整块 `return null`，不持久化
- **允许修改文件**：不适用（本项无需改动）
- **禁止事项**：不得以「统一处理智慧校园」为由误改此处已正确的 fail-closed 逻辑
- **验证方式**：人工核对当前逻辑保持不变

---

## 五、非本 Phase 执行范围（仅记录顺序占位）

### 16. 墨青纸感组件库迁移
- **当前状态**：设计语言已定稿于 `docs/design/inkpaper-design-language.md`，真实页面仍为手写旧样式
- **最终动作**：**后续商业化/真实化**——明确排在本 IA 决策表之后，属 Phase B（`packages/ui` 组件库）+ Phase C（单页试点）+ Phase D（逐页迁移）范围，**不在本清单 Phase A 的执行范围内**
- **允许修改文件**：不适用（未来 Phase B 任务启动时另行定义，且需用户明确解冻 UI 后才能动 `packages/ui` 与 `apps/`）
- **禁止事项**：Phase A 阶段不得预先改动 `packages/ui` 或任何页面视觉样式
- **验证方式**：不适用（Phase B 任务自行定义）

---

## 六、当前状态与下一步

- 第 1–7、9–14 项为未来真实化可执行项；第 8 项仅记录后续独立任务；第 15 项为撤销确认、无需改动；第 16 项明确排除在外。
- **当前未改任何运行时代码、未解冻 UI、未新增功能、未 git add、未提交。**
- 用户审阅本清单后，若确认进入代码真实化，将从干净 `main` 新建独立分支 / worktree，按一任务一分支推进，不合并多项到同一分支/提交。
- 在用户明确确认前，不另起分支，不改 `packages/ui`，不改 `/print-scan` 或任何列表中的页面文件。
