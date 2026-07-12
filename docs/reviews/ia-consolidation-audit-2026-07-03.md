# IA 收口盘点与决策表（2026-07-03）

> 只读盘点产出。**本轮不改运行时代码、不解冻 UI、不新增功能、不 git add、不提交。**
> 关联：[user-data-flow-matrix.md](../product/user-data-flow-matrix.md) · [feature-scope.md](../product/feature-scope.md) · [inkpaper-design-language.md](../design/inkpaper-design-language.md) · [next-tasks.md](../progress/next-tasks.md) · [compliance-boundary.md](../compliance/compliance-boundary.md)
> 方法：逐一比对三端实际路由 / 侧栏 / 页面组件源码 + Prisma/服务调用 + 现有正式文档，不臆测状态。

---

## 0. 本轮边界（硬约束）

- 只做只读盘点与 IA 决策口径，**不动 `apps/` / `services/` / `packages/` 运行时代码**。
- 不解冻 UI（[ui-ux 冻结口径](../product/feature-scope.md) 仍生效，仅允许后续「真实化」）。
- 不新增入口、不新增同义卡片、不补假闭环。
- 墨青纸感真实实施排在本决策表**之后**，另起干净分支做 `packages/ui` + 单页试点。

---

## 1. 「需逐页确认」项裁定结果（本轮消灭待确认）

| 项 | 结论 | 证据路径 |
|---|---|---|
| Admin 智慧校园 | ✅ **真闭环（代码侧）**：真实配置页，`smartCampusService.saveConfig(terminalId,{enabled,modules})` 控制各终端 Kiosk 智慧校园开关 | `apps/admin/src/routes/smart-campus/index.tsx:43` |
| Admin AI大模型 | ✅ **真闭环（代码侧）**：LLM 预设 / 功能 / 配置真实读写。**限定**：仅 `active` 功能的配置会被运行链路消费；`planned` 功能可先保存配置，但当前不影响线上流程（页面文案原话） | `apps/admin/src/routes/ai-config/index.tsx:25`（`services/api/aiConfig`）；限定原文见 `apps/admin/src/routes/ai-config/index.tsx:176` |
| Admin 权限管理 | ⚪ **占位（诚实）**：整页 `EmptyState`「功能建设中，上线前暂不开放」 | `apps/admin/src/routes/permissions/index.tsx:5-14`（全 15 行） |
| Partner 企业资料管理 | ✅ **真闭环（代码侧）**：`partnerCompaniesService`，含审核状态筛选 | `apps/partner/src/routes/companies/index.tsx:25,202`（`services/api/partnerCompanies`） |
| ⑦ Kiosk 首页智慧校园入口 | ✅ **原「硬编码」结论撤销**：受 `useSmartCampusConfig` 控制，默认 OFF、fail-closed、无 terminalId / 网络失败 / 未授权 → 整块 `return null`，不持久化（搬离校园后端返回 `enabled:false` 即消失） | `apps/kiosk/src/pages/home/HomePage.tsx:577-620`（`if (!config.enabled || enabledTiles.length===0) return null`）+ `apps/kiosk/src/hooks/useSmartCampusConfig.ts:7-52` |

> ⑦ 更正说明：初次盘点仅凭 grep 见 `迎新服务/VR校园` 常量即疑硬编码；读渲染逻辑后确认为范本级合规门控设计，**无需处置**。`SMART_CAMPUS_TILES` 只是查找表，渲染完全由后台配置驱动。

---

## 1.1 用户复核修正（2026-07-03，二次只读复核）

用户逐条核对本文档后指出 2 处状态裁定需要修正，已逐一读源码核实，结论如下：

| # | 原裁定 | 错误 | 修正后结论 | 证据路径 |
|---|---|---|---|---|
| A | Admin「用户管理」被归入 §2.2「机构用户」分组的「多数真闭环」笼统表述，未单独核实 | **误判**：实际是 15 行纯 `EmptyState`「功能建设中，上线前暂不开放，敬请期待」，与「权限管理」是同一占位模式 | Admin「用户管理」应与「权限管理」一并归为 **⚪ 占位（诚实）**，动作同为**隐藏或保留禁用** | `apps/admin/src/routes/users/index.tsx:5-14`（全 15 行，与 `permissions/index.tsx` 逐行同构） |
| B | Partner「智慧校园」整页归为「建设中（`尚未`）」，建议整页隐藏或禁用 | **误判**：grep 命中的 `尚未` 只是子 Tab 内的诚实空态文案，未读整页三段式结构，误将局部空态泛化为整页建设中 | Partner「智慧校园」是**混合状态页**，不可整页隐藏：<br>· **终端开关 Tab**：✅ 真闭环 —— `saveSmartCampusConfig` 按 `orgId` 隔离、写审计日志、直接联动 Kiosk 首页 `useSmartCampusConfig` 显隐（保存后约 5 分钟生效）<br>· **迎新内容 / 使用统计 Tab**：⚪ 诚实空态 —— `NotOpenState` 组件明确「尚未开放」，不展示任何示例/假数据<br>· **校园大数据**：🔒 本期强制冻结 —— `toggle()` 函数对 `key==='bigdata'` 直接 `return`，UI 开关 `disabled` | `apps/partner/src/routes/smart-campus/index.tsx:16`（顶部合规说明注释）、`:154-155`（`if (key === 'bigdata') return`）、`:260-288`（`OrientationPanel`/`UsagePanel` 诚实空态）、`:290-338`（页面整体三段式结构+顶部状态说明卡） |

**根因**：本轮盘点对「需确认清单」外的页面，多依赖 grep 关键词命中 + 目录级归类（如整个「机构用户」分组标「多数真闭环」），未逐页开文件核实；grep 关键词命中占位文案（`尚未`/`敬请期待`）时也未区分「整页占位」与「页内子区域占位」。**修正已直接应用到 §2.2/§2.3 功能地图表格、§3 决策表（⑥/⑥b）、§4 拍板裁定（7/8）、§5 动作分类汇总，本节（§1.1）只作为修正记录留痕，不重复维护第二份表。**

---

## 2. 功能地图（三端，按实际路由 / 侧栏）

### 2.1 Kiosk（路由源：`apps/kiosk/src/routes/index.tsx`）

| 功能 | 入口 | 状态 | 数据归属 | 合规 | 动作 |
|---|---|---|---|---|---|
| AI简历诊断/优化/素材库/求职材料/职业规划/简历打印 | `/resume/*`、`/print/upload` | 真闭环 | 我的简历·文档·AI记录·打印 | 安全 | 保留 |
| 岗位大师 | 首页占位 | 占位（**2026-07-11 用户已拍板确认**：采纳本条"合并复用"方向，非采纳同期 `feature/job-master` 分支已完成的独立 M1/M1.5 实现；该分支 PR #117 降级为素材参考，不再推进为独立入口） | 复用 2D 匹配 | 安全 | 合并·不新增同义入口（执行中） |
| 全职/实习/兼职/全部岗位·找企业 | `/jobs*`、`/companies*` | 真闭环 | 收藏·浏览跳转 | 安全（非招聘平台） | 保留 |
| 社会/校园招聘会·扫码签到 | `/job-fairs*`、`/campus` | 真闭环 | 收藏·浏览·文档·打印 | 安全（只记打开） | 保留 |
| 文档打印 | `/print/upload`、`/print-scan` | 真闭环 | 我的文档·打印 | 安全 | 保留·统一口径 |
| 纸质/材料扫描 | `/scan/start` | **2026-07-11 更正：已代码级真实闭环**（`feature/real-scan` 2026-07-10 合并 `main`：`ScanTask` 模型 + Agent `scan-watcher.ts` 监听 SMB 共享目录 + Kiosk 四页面接真，不再是 `mockFile()`；原「半成品（演示）」结论已过期） | 我的文档 | 安全（诚实标注，代码不再演示） | **待真机**（仅剩 Windows 硬件端到端验收未完成，非整链路未做） |
| 证件复印/证件照/~~云打印~~/格式转换/签名盖章/U盘 | 首页占位·`/print-scan` | 占位 | — | 安全 | **待真机·诚实禁用/隐藏**（**2026-07-12 更新**：「云打印」已按正式取舍决策从首页删除，能力归位文档打印+手机扫码上传，见 `docs/reviews/2026-07-12-cloud-print-decision.md`） |
| 模拟面试/面试技巧/面试报告 | `/interview/*` | 真闭环 | AI记录·面试报告·打印 | 安全 | 保留 |
| 就业政策/补贴/档案 | `/renshi?tab=*` | 真闭环（材料打印待源） | 收藏·浏览·文档 | 安全（info-only） | 保留 |
| AI助手（小青） | `/assistant` | **半成品（会话不落库）** | ❌ 无记录 | 安全（诚实） | 保留·落库列 P2 |
| 权益活动/我的权益/消息/反馈 | `/activities`、`/me/*` | 真闭环 | 权益·消息·反馈 | 安全（脱敏，无支付核销） | 保留 |
| 我的简历/文档/订单/AI记录/收藏/活动/设置/帮助 | `/me/*`、`/help` | 真闭环 | 各资产 | 安全 | 保留 |
| 求职打印套餐/AI服务套餐/招聘会扫码凭证 | 「我的」建设中入口 | **占位（套餐/支付/凭证域）** | — | 安全 | **隐藏或禁用** |
| 智慧校园/迎新/VR校园 | `/smart-campus/*`（首页受开关控制） | 半成品（子页即将上线） | — | ✅ 已受后台开关控制 | 子页真实化前保持禁用；入口门控无需改 |
| 待机宣传屏 | `/screensaver` | 真闭环（一期） | — | 安全 | 保留 |

### 2.2 Admin（侧栏源：`apps/admin/src/layouts/AdminLayoutWrapper.tsx`，26 项）

| 分组 | 页面 | 状态（代码侧） | 动作 |
|---|---|---|---|
| — | 工作台 | 真实聚合 | 保留 |
| 设备运维 | 设备管理 | 真实状态+降级 | 保留·待真机 |
| | 宣传屏 | 一期真闭环（AI 文生图二期 stub） | 保留 |
| | 百宝箱 | 进行中（治理 gate 未收口） | 保留·随 TB/TAS gate |
| | 智慧校园 | ✅ 真闭环 | 保留 |
| | 告警中心 | 真闭环（实时派生，无持久化 Alert 表） | 保留 |
| 业务管理 | 订单/文件/求职材料库/AI服务管理 | 真闭环（代码侧） | 保留 |
| | AI大模型 | ✅ 真闭环 | 保留 |
| 数据内容 | 岗位/招聘会/政策信息源·招聘会管理·企业展示·Excel导入·API同步 | 真闭环（代码侧，接真） | 保留 |
| 机构用户 | 合作机构/权益活动/会员权益/意见反馈/消息通知 | 真闭环（代码侧） | 保留 |
| | **用户管理** | ⚪ **占位（诚实 EmptyState，2026-07-03 修正）** | **隐藏或保留禁用** |
| 系统管理 | 权限管理 | ⚪ **占位（诚实 EmptyState）** | **隐藏或保留禁用** |
| | 日志审计 | 真闭环 | 保留 |

### 2.3 Partner（侧栏源：`apps/partner/src/layouts/PartnerLayoutWrapper.tsx`，12 项）

| 分组 | 页面 | 状态 | 动作 |
|---|---|---|---|
| — | 工作台 | 真实聚合 | 保留 |
| 机构信息 | 机构资料 | 真闭环（allowlist 锁定） | 保留 |
| 数据管理 | 岗位信息管理 | 真闭环（质量看板接真） | 保留 |
| | 企业资料管理 | ✅ 真闭环 | 保留 |
| | 招聘会信息管理 | 真闭环 | 保留 |
| 校园服务 | 智慧校园（**2026-07-03 修正为混合状态，见 §1.1 B**） | 终端开关=✅真闭环；迎新内容/使用统计=⚪诚实空态；校园大数据=🔒强制冻结 | **保留终端开关；迎新内容/使用统计维持诚实空态；校园大数据继续冻结（不隐藏整页）** |
| | 政策公告管理 | 真闭环 | 保留 |
| | 数据源管理 | 真闭环（三轨·凭证不回显） | 保留 |
| | 同步日志 | 真闭环 | 保留 |
| 数据与账号 | **终端数据** | **建设中（敬请期待）** | **隐藏或禁用** |
| | **数据统计** | **建设中（敬请期待）** | **隐藏或禁用** |
| | **账号权限** | **建设中（敬请期待）** | **隐藏或禁用** |

证据：`apps/partner/src/routes/{terminals,stats,account}/index.tsx`（`敬请期待/建设中`）。智慧校园证据见 §1.1 B（混合状态，不与上述三个纯占位页同类）。

---

## 3. IA 决策表（裁定 + 证据 + 动作分类）

| # | 裁定 | 证据路径 | 动作分类 |
|---|---|---|---|
| ① | 「我的」不扩成第二个首页；`ProfilePage` 只做入口+概览+本次记录；「常用服务」≤少量快捷入口，**不再新增** | `docs/product/user-data-flow-matrix.md` 顶部整改（2026-06-14）；`apps/kiosk/src/pages/profile/ProfilePage.tsx` | **约束（保留现状，冻结扩张）** |
| ② | 打印扫描口径统一：以 next-tasks §「首期服务中心与能力开关」清单为**能力上限**；首页打印组仅作进入 `/print-scan` 的入口，不自带子项；每项由 FeatureGate/DeviceCapability/Admin 配置控制显隐 | 首页 `apps/kiosk/src/pages/home/HomePage.tsx` 打印卡 vs `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`；`docs/progress/next-tasks.md`（P0 打印扫描首期 §「首期服务中心与能力开关」） | **统一口径** |
| ③ | 扫描链路生产/HTTP 下仍是演示，打通前不产真实 FileObject、不进「我的」、不包装成完成 | `apps/kiosk/src/pages/scan/ScanStartPage.tsx`（`流程演示/待接入`）；matrix §3.4 | **待真机后开放** |
| ④ | 套餐/支付/核销/招聘会扫码凭证域不上线前**不补假闭环** | matrix §3.9（`求职打印套餐/AI服务套餐/招聘会扫码凭证 ❌`）；`apps/kiosk/src/pages/profile/ProfilePage.tsx`（建设中入口） | **隐藏或禁用** |
| ⑤ | 扫描/证件复印/证件照/U盘/云上传/格式转换/签名盖章 真机/生产验收前只允许诚实禁用或隐藏 | matrix §3.4；next-tasks P0 打印扫描首期各子项 | **待真机后开放** |
| ⑥ | Admin 权限管理、**Admin 用户管理**（2026-07-03 修正并入）、Partner 终端数据/数据统计/账号权限 优先隐藏或禁用，不补假页 | `apps/admin/src/routes/permissions/index.tsx`；`apps/admin/src/routes/users/index.tsx`；`apps/partner/src/routes/{terminals,stats,account}/index.tsx` | **隐藏或禁用** |
| ⑥b | Partner 智慧校园**不整页隐藏**（2026-07-03 修正）：终端开关是真闭环需保留；迎新内容/使用统计维持诚实空态；校园大数据继续冻结 | `apps/partner/src/routes/smart-campus/index.tsx:16,154-155,260-288,290-338`（详见 §1.1 B） | **拆分处理（保留+维持空态+冻结）** |
| ⑦ | 智慧校园首页入口已受 `useSmartCampusConfig` 门控（默认 OFF/fail-closed/未授权不渲染），**无需处置** | `apps/kiosk/src/pages/home/HomePage.tsx:577-620`；`apps/kiosk/src/hooks/useSmartCampusConfig.ts` | **无需处置（撤销原结论）** |
| ⑧ | 岗位大师首页占位点亮时复用 2D 岗位匹配参考，不新增同义入口。**2026-07-11 用户拍板确认**：与同期出现的 `feature/job-master`（M1+M1.5 独立实现，PR #117）冲突已裁定，采纳本条方向；job-master 分支降级为素材参考，不再推进独立入口，见 `docs/reviews/home-entry-closure-plan-2026-07-11.md` | matrix §3.2；§二入口稳定规则 | **合并（执行中）** |
| ⑨ | AI助手会话落库需隐私先行（TTL/脱敏/本人可删），列 P2，不属上线收口 | matrix §3.7 | **后续（非本轮）** |
| ⑩ | 墨青纸感真实实施排在本表之后，先 `packages/ui` 组件库再逐页迁移，不每页手搓 | `docs/design/inkpaper-design-language.md`；真实页仍旧灰白样式 | **后续商业化/真实化** |

---

## 4. 用户已拍板裁定（2026-07-03，作为口径固化）

1. 打印扫描口径必须统一，以 next-tasks 首期能力清单为**上限**，上线前按 FeatureGate/DeviceCapability/Admin 配置控制显隐。
2. 「我的」不得扩成第二个首页，常用服务最多少量快捷入口，不再增加。
3. 套餐/支付/核销/招聘会扫码凭证不上线前不补假闭环。
4. 扫描/证件复印/证件照/U盘/云上传/格式转换/签名盖章 真机/生产验收前只允许诚实禁用或隐藏。
5. Partner 三个建设中页（终端数据/数据统计/账号权限）优先隐藏或禁用，不补假页。
6. 墨青纸感真实实施排在 IA 决策表之后：先文档定口径，再另起干净分支做 `packages/ui` 组件库与单页试点。
7. **（2026-07-03 复核新增）** Admin「用户管理」与「权限管理」同为纯占位，一并隐藏或保留禁用。
8. **（2026-07-03 复核新增）** Partner「智慧校园」不得整页隐藏：终端开关（真闭环，已联动 Kiosk）必须保留；迎新内容/使用统计维持诚实「未开放」空态；校园大数据继续强制冻结。

---

## 5. 动作分类汇总

- **统一口径**：② 打印扫描能力清单与显隐门控。
- **隐藏 / 禁用（上线前）**：④ Kiosk 套餐凭证入口；⑥ Admin 权限管理 + **用户管理**、Partner 终端数据/数据统计/账号权限；Kiosk 智慧校园子页（未真实化前）。
- **待真机后开放**：③⑤ 扫描/证件复印/证件照/U盘/云上传/格式转换/签名盖章。
- **合并 / 去重**：⑧ 岗位大师 → 岗位匹配参考。
- **拆分保留（不整页隐藏）**：⑥b Partner 智慧校园 —— 终端开关保留、迎新内容/使用统计维持诚实空态、校园大数据继续冻结。
- **保留（真闭环，回归即可）**：AI简历全链路、岗位、招聘会、面试、政策、我的资产/消息/反馈/权益、宣传屏；Admin 除权限管理/用户管理外多数页；Partner 除三建设中页外多数页（含智慧校园终端开关）。
- **约束（冻结扩张）**：① 「我的」不再新增服务入口。
- **后续（不进上线收口）**：⑨ AI助手会话落库（P2）；套餐/支付/核销域；⑩ 墨青纸感组件库迁移。

---

## 6. 下一步（等用户确认是否进入代码真实化）

盘点与决策口径到此结束。若用户确认「解冻并开始真实化」，按既定顺序、另起干净 `main` 分支 / 独立 worktree、一任务一分支推进：

- **Phase A**：把本表固化为可执行 IA 决策清单（仍是文档）。
- **Phase B**：墨青纸感沉到 `packages/ui` 组件库。
- **Phase C**：选 1 个高频页试点（建议 `/print-scan`：口径最乱、收益最大）。
- **Phase D**：逐页迁移，每页只做三件事——去重入口、套设计组件、接真数据 / 诚实空态。

**当前状态：未改代码、未解冻、未 git add、未提交。等待用户确认。**
