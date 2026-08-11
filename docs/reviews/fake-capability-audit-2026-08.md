# 伪造能力全端审查总账 + 两线对账

> 日期：2026-08-11
> 方法：Claude 手工排查 + Codex（gpt-5.6-sol / xhigh）无范围限制全端扫描，**独立进行后合并**
> 依据：CLAUDE.md §9「不伪造能力」——没有真实数据、真实接口、真实硬件状态或真实保存结果时，
> 页面不得展示已完成、已保存、已投递、已打印、设备正常等结论
> 修复门禁：`apps/kiosk/scripts/verify-smart-campus-ui.mjs`（G 组）、
> `verify-jobfair-commercial-closure.mjs`（第 6 组）

---

## 零、一句话结论

**共 23 处**（本轮已修 6 处 + 新发现 17 处）。
**三端里 Kiosk 前台最集中**，问题类型集中在**官方来源背书、状态结论、"可直接使用/打印"的能力承诺**。

根因是同一个：**前端先写了产品愿景，后端没跟上，文案却已经在对用户承诺。**

---

## 一、已修（6 处，commit `6eed3e10`）

| # | 位置 | 声称 | 后端实际 |
| --- | --- | --- | --- |
| 1 | `SmartCampusWelcomePage` | 四个办事窗口含「行政楼 1F」「东门内 50m」+「校方官方指引」徽标 | **位置不来自任何学校**，纯硬编码 |
| 2 | `SmartCampusServicePage` | 四处楼层位置 +「校方合作行李帮运」 | 同上，且无任何校方合作证据 |
| 3 | `SmartCampusHomePage` | 「校方授权的官方校园服务入口」 | 开关**平台 Admin 同样可设置** |
| 4 | `HomePage` | 「校方已开启」 | 同上 |
| 5 | 招聘会资料页 ×4 处 | 「免费打印」「免费出纸」「可免费打印」 | `purpose` 只用于安全门禁，**不参与计价**，照样按 `PriceConfig` 收费 |
| 6 | Admin 招聘会统计 | `viewCount` 标「终端浏览次数」 | **全项目零递增写入**，恒为 0 |

---

## 二、新发现（17 处，Codex 扫描）

### 2.1 🔴 官方与来源背书（5 处，最高优先）

> 共同点：**向用户暗示内容经过官方核验，但后端没有任何核验机制。**
> 这类问题在政策与岗位场景尤其危险——用户会据此做出办事或求职决策。

| # | 位置 | 声称 | 后端实际 |
| --- | --- | --- | --- |
| **F1** | `PolicyServiceHubPage.tsx:48`<br>`PolicyPanel.tsx:137`<br>`partner/policy/index.tsx:371` | 政策及任意外链称「**人社部门官方口径 / 官方入口**」 | `policy.dto.ts:41` 只把**合作机构自填链接当普通字符串**接收；`policies.service.ts:135` **无官方域名、发布主体或证据核验** |
| **F2** | `SmartCampusHomePage.tsx:228` | 扩展应用均经「**校方审核后上架**」 | 审核接口是**仅限管理员**的 `admin-toolbox.controller.ts:28,149`，**没有校方审批角色或记录** |
| **F3** | `OnlinePlatformsPage.tsx:16,146` | **硬编码四个平台主页**并提供「去来源平台投递」 | 完全绕过后端已设计的 `OnlinePlatformDirectory`（官方域名/证据/审核/链接检查）；**且平台主页不是具体岗位投递地址** |
| **F4** | `JobsServiceHubPage.tsx:68`<br>`JobDetailSections.tsx:172,179` | 岗位统称「**权威来源 / 来源可信**」+ 硬写来源类型为「线上招聘平台」 | `jobs-kiosk.service.ts:48` **仅检查审核与发布状态**，无法证明权威性；来源可能是 Excel、手工或学校录入 |
| **F5** | `CampusTabs.tsx:141`<br>`FairMapPage.tsx:265`<br>`FairStatsPage.tsx:117` | 招聘会信息/导览/统计归因于**主办方** | 展区实际由**管理员接口**写入；`jobs-kiosk.service.ts:326` 直接**硬编码「主办方录入数据」** |

> **F3 与本仓 J2 是同一件事的两面**：终端在硬编码推荐平台，
> 而后端已设计好的治理目录（`OnlinePlatformDirectory`）**两个后台都没有写入口**。
> 修 J2（建 Admin 治理页）时必须同时把 F3 的硬编码换成读目录。

### 2.2 🟠 状态与完成结论（5 处）

| # | 位置 | 问题 |
| --- | --- | --- |
| **F6** | `ConvertImagesPage.tsx:172,267` | **不要求登录**却承诺 PDF 已保存到「我的文档」；匿名上传 `endUserId` 为空，而会员文档只查已认证用户资产——**用户回头找不到文件** |
| **F7** | `SessionResumePage.tsx:139` | 待续办列表为空即显示「**所有任务已完成**」；但后端同时排除了失败、关闭、退款等状态，**空列表不等于全部完成** |
| **F8** | `ErrorOfflinePage.tsx:76` | 声称上传/订单/状态上报「**排队等待、恢复后自动继续**」；实际该页**只轮询健康接口**，没有离线写队列或持久化重放 |
| **F9** | `partner/sources/index.tsx:36,444` | 数据源显示「**已连接**」；后端只要「已启用且最后状态非失败」即判 connected——**新建且从未同步的 Excel/手工源也显示已连接** |
| **F10** | `partner/sources/index.tsx:123,286` 🟡 | 浏览器不支持 Clipboard API 时**没有任何复制动作**，仍把一次性 Webhook 密钥标成「已复制」——密钥只显示一次，用户会因此丢失 |

### 2.3 🟠 数据与统计（1 处，与已修的 viewCount 同型）

| # | 位置 | 问题 |
| --- | --- | --- |
| **F11** | `FairMaterialsPage.tsx:168`<br>`admin/MaterialsTab.tsx:151`<br>`admin/StatsTab.tsx:11` | 两端把 `printCount` 当**真实打印次数**展示，但**全后端没有出纸完成后递增 `FairMaterial.printCount` 的写路径**——资料转打印文件时只更新桥接记录 |

> **F11 与已修的 viewCount 是同一个模式**：字段存在、有默认值、被展示，但**没有任何写入方**。
> 建议按「数据源」而非「页面」做一次收口——**先确认字段有无写入方，再反查全部展示位置**。

### 2.4 🟠 能力与功能承诺（4 处）

| # | 位置 | 声称 | 后端实际 |
| --- | --- | --- | --- |
| **F12** | `PrintMaterialCheckPage.tsx:494` | 「**AI 文件预检**」会检查边距与打印风险 | 后端返回 `basic_inspection`，只有格式/大小/页数/图片质量，**没有 AI，也没有边距分析** |
| **F13** | `PolicyServiceHubPage.tsx:105,137` | 「政策收藏」「AI 政策问答记录」进入 `/me/ai-records` | 目标页**只加载简历与岗位 AI 记录**；助手会话**只存在进程内存**，重启即失 |
| **F14** | `ResumeSourcePage.tsx:111,120` | 上传控件与说明明确**支持旧版 DOC** | 后端识别 `.doc` 后**固定返回「不支持旧版 .doc」** |
| **F15** | `AssistantPage.tsx:161,245,280` | 助手称自我介绍/清单/面试题**可直接打印** | 后端只返回文本与导航动作，「打印」**只是跳到空白上传页**，不生成任何可打印文件 |

### 2.5 🟠 设备与告警（2 处）

| # | 位置 | 问题 |
| --- | --- | --- |
| **F16** | `admin/TerminalToolboxRow.tsx:84`<br>`admin/screensaver/index.tsx:732`<br>`partner/smart-campus/index.tsx:237` | 显示确定的终端**在线/离线**，但判定依据是 `Terminal.lastSeenAt`——该字段是 **`@updatedAt`，任意终端更新都会刷新**，不是真心跳。`terminals-admin.service.ts:270` 才是正确实现（要求真实心跳存在） |
| **F17** | `admin/alerts/index.tsx:60,103` | **任一分类筛选结果为空**就宣称「所有终端在线、打印机正常、近 24 小时无失败」；但后端返回三类**相互独立**的告警，其他分类仍可能有故障 |

> **F16 是最容易误导运维的一条**：`@updatedAt` 会因任何写操作刷新，
> 一台已断电的终端只要有别的流程更新了它的行，就会显示"在线"。

---

## 三、两线对账（A 线 = 主仓库 kiosk V3，B 线 = 本工作区）

### 3.1 冲突面：只有 3 个文件，且都可合并

| 文件 | 情况 |
| --- | --- |
| `.claude/launch.json` | 不同数组区域，可合并；**但 B 的绝对 worktree 路径不能原样进 main** |
| `apps/kiosk/src/pages/home/HomePage.tsx` | A 改登录跳转 + 百宝箱渲染，B 改「本机已开启」口径与 `enabled` 过滤——**不同区域**；且 A 的施工方案本身也要求按配置过滤，属旧基线差异而非结论冲突 |
| `docs/progress/current-progress.md` | **同一处文本真冲突**，双方都在顶部插入进度。必须按时间顺序人工合并，**不能选 ours/theirs** |

> ⚠️ Git 实测：A 相对 B 是 **B 侧 96 提交 / A 侧 18 提交**，
> **不是可以直接快进的「单纯领先 main 18 个提交」**。

### 3.2 A 线的两个诚实性脚本为什么没抓到

| 脚本 | 实际读取范围 | 检查什么 |
| --- | --- | --- |
| `verify-kiosk-visible-actions-truth.mjs` | **7 个硬编码文件**（线下机构/场馆导览/简历导出/合同审查×2/合同 API/简历中心） | 搜索是否真接线、导览不伪造点位、无真实文件禁止导出、合同报告开关与 feature flag |
| `verify-print-confirm-honest.mjs` | 确认/收银/进度/完成页/唤醒/支付 API | 无 fileUrl 不得进模拟打印、金额必须来自服务端报价、付费单必须进收银、SIM 演示标识隔离 |

**结论有三条，都很明确：**

1. **违规页面根本不在两个脚本的读取清单里**——实跑仍全部 PASS
2. **两脚本没有文件参数或通用文本输入接口**——「把 B 的六处输入脚本」在机制上做不到
3. 即使把「校方官方/免费打印/终端浏览次数」复制进已监控文件，**也不会因这些词本身 FAIL**

→ **它们是「针对已知问题写死断言的防回归脚本」，不是通用伪造检测器。**
覆盖的是"曾经出过问题的地方"，本轮找的是"还没被发现的地方"。**两者互补，不矛盾。**

### 3.3 A 线是否已修过同类问题：没有

A 线**生产代码仍保留全部 6 处**（因为它的 18 个提交只改 `docs/design/`，`apps/kiosk/src` 下 0 个文件）。

其「收银唯一通道」只保证**所有真实出纸进入 P06**，
**不负责证明某项服务确实享有免费资格**；
「假入口清零 / 无产物不可打印」检查的是**按钮与文件产物真实性**，
不检查楼栋、校方授权、补贴资格或统计口径。

> 有意思的是：A 的静态样张 `19-smart-campus.html:127-137` **反而诚实展示「未接入、无数据」**——
> 说明 A 线自己也知道这块没接入，只是没回头改生产页面。

### 3.4 🔴 最重要的一条：A 的新原型会造成下一轮伪造

> `docs/design/kiosk-ai-os-v3-2026-08/24-benefits.html:144-147,259-274,344-470`
> **硬编码「市人社局每月 20 页」、余额、使用记录和按页结算。**

**若直接落地，会成为新一轮同类伪造**——因为后端目前：

- 没有 `FundingProgram`（答不出谁出资、预算多少）
- 没有额度模型（`BenefitGrant` 无面值、无服务范围、无页数上限）
- `purpose` 不可信（简历打印入口实际写 `print_doc`，且匿名接口可自报）
- 计价链拿不到场景（`quotePrint` 只有页数/份数/颜色）
- 全额抵扣漏洞（`discountCents = order.amountCents`）

**这正是两线对账最大的价值**：
A 线定义了要什么（而且比 B 线的方案更早、更具体），
B 线查清了为什么还做不到、以及要补什么。
**两条线不是冲突，是同一件事的需求侧与约束侧。**

修复路径见 [`pricing-benefit-campaign-plan-2026-08.md`](../product/pricing-benefit-campaign-plan-2026-08.md) §4.5 与 W0/S-1~S-6。

### 3.5 合并顺序建议

```
① 先合 B 线（真实性修复 + 门禁断言 + CI 缺口）
② 再从最新 main 选择性迁入 A 的 V3 设计
③ 迁入前，24-benefits.html 必须标注「需 FundingProgram/SubsidyRule 落地后才能实现」
```

**不要把 A 的脏工作区整树覆盖到 B 之上**——那会把已修的 6 处伪造带回来。

---

## 四、方法论结论（比单条修复更重要）

本轮六处已修问题里，有两组是**同一功能的多个页面只改了一两个**
（智慧校园三页、招聘会四处）。第一轮都漏了。

**说明「按页面找」这个方法本身有漏。** 有效的方法是**按数据源找**：

```
① 确认某个字段/能力是否有真实写入方或后端支撑
② 若没有 → 反查它的全部展示位置，一次改完
③ 把结论钉成断言，让门禁防回归
```

`viewCount`（已修）与 `printCount`（F11）都是这么找到的。
建议后续对 `printCount`、`lastSeenAt`（F16）、告警聚合（F17）按同法收口。

---

## 五、交给 Codex 的开发任务（剩余 9 处 + 配套能力）

> **分工（产品所有者 2026-08-11 明确）**：Claude 负责审查、方案与规格；**真实功能开发由 Codex 执行**。
> 本节把剩余问题整理为可直接开工的任务，每条给出：改哪里 / 做什么 / 验收 / 依赖。
> 已修的 14 处见 §一、§二，不在此列。

### 任务优先级总览

| 任务 | 问题 | 严重度 | 依赖 | 建议批次 |
| --- | --- | :---: | --- | :---: |
| **T1** | F1 后端域名白名单（政策 + 线上平台 + 百宝箱三合一） | 🔴 | 无 | **第一批** |
| **T2** | F3 线上平台目录治理（Admin 页 + Kiosk 改读目录） | 🔴 | T1 | **第一批** |
| **T3** | F4 岗位来源可信度分级 | 🔴 | T1 | 第二批 |
| **T4** | F5 招聘会主办方归因去伪 | 🔴 | 无 | 第二批 |
| ~~**T5**~~ | ~~F2 校方审核角色或文案收敛~~ | ✅ | 产品已拍板 B | **已完成** |
| **T6** | F9 数据源「已连接」语义收紧 | 🟠 | 无 | 第三批 |
| **T7** | F7 续办列表空态语义 | 🟠 | 无 | 第三批 |
| **T8** | F13 AI 记录聚合（政策收藏 / 问答记录） | 🟠 | 会话持久化 | 第三批 |
| **T9** | F8 离线写队列 | 🟠 | 独立立项 | 择期 |

---

### T1 · 官方域名白名单三合一 🔴

**问题**：政策 `externalUrl` 无任何核验即被展示为可扫码办理入口（前端文案已于 `366bf1fb` 撤回「官方」字样，但**链接本身仍不校验**）。

**改哪里**（Codex 已给出具体位置）：

| 位置 | 做什么 |
| --- | --- |
| `services/api/src/policies/dto/policy.dto.ts:41-42,67-68` | 加 `@IsUrl({protocols:['https'], require_protocol:true, require_tld:true, disallow_auth:true})` + `@MaxLength(500)`，类型放开为 `string \| null`（`null` 用于清除旧链接） |
| `apps/partner/src/routes/policy/index.tsx:151` | 编辑时空值必须传 `null` 而非 `undefined`，否则无法真正删除旧链接 |
| `services/api/src/policies/policies.service.ts:138` | 创建入库前校验非空 `externalUrl` |
| `services/api/src/policies/policies.service.ts:172` | 更新时只校验本次明确提交的非空新链接；`null` 允许清除 |
| **`services/api/src/policies/policies.service.ts:291-297`** | **`publish` 前再次校验——这是不可绕过的最终门禁** |
| `services/api/src/policies/policies.service.ts:119` | 公开列表批量核验后才返回 `externalUrl`；**未核验时只隐藏链接、不隐藏政策正文** |
| `services/api/src/policies/policies.module.ts:9` | 导入 `TerminalsModule`，注入已导出的 `ToolboxGovernanceService` |

**复用 ToolboxAllowedHost 的哪部分**：

- ✅ `toolbox-governance.ts:98-113` 状态 / 暂停 / 过期 / 有效期判定
- ✅ `toolbox-governance.service.ts:397-447` 提交进 pending_review、异人审核、责任人、原因、到期
- ✅ `toolbox-governance.ts:176-212` URL/host 解析——**需抽成公共函数**，并补禁止账号密码、HTTP、localhost、私网 IP
- ❌ **不要**整个复用 `evaluateToolboxPublishGate`（`:115-160`）——其中混有微应用状态、权限、免责声明等无关规则

**统一接口**（三处共用一张物理表，不需改表名）：

```ts
type ExternalHostPurpose =
  | 'web_app' | 'qr_target' | 'asset'
  | 'policy_external'            // 新增
  | 'online_platform_official'   // 新增

async assertApprovedExternalTarget(input: {
  target: { kind: 'url' | 'host'; value: string }
  purpose: ExternalHostPurpose
  expectedOwner?: string
  requireEvidence?: boolean
  evidenceFileId?: string | null
  now?: Date
}): Promise<{ approvalId: string; host: string; reviewedAt: Date; expiresAt: Date | null }>
```

**校验顺序固定**：HTTPS / 无认证信息 → 非本机私网 → 精确 host 命中 → `active` → 未到期 → `expectedOwner` 与审批记录一致 → 官方用途具备证据。

**同步扩展字面量**：`toolbox-governance.ts:16`、`toolbox-governance.helpers.ts:24`、`dto/toolbox-governance.dto.ts:14`、`packages/shared/src/types/toolboxMicroApp.ts:74`。

**存量处理**：已发布政策若链接不合规，**只隐藏链接、不下架正文**——避免一次性清空生产内容。

**验收**：
- 非 HTTPS / 带账号密码 / 私网 IP / 未审批 host 的 `externalUrl` 在 create、update、publish 三处均被拒
- 已发布政策链接失效后，Kiosk 仍展示正文但不展示扫码入口
- 百宝箱原有环境变量双白名单**保留**，不因共表而删除

---

### T2 · 线上平台目录治理 🔴

**问题**：`OnlinePlatformsPage.tsx:16,146` **硬编码四个平台主页**并提供「去来源平台投递」，完全绕过后端已设计的 `OnlinePlatformDirectory`（含官方域名、证据、审核、链接检查）；**且平台主页不是具体岗位投递地址**。

**做什么**：
1. 建 Admin 治理页 —— 原型已出：`docs/design/console-ai-os-2026-08/admin/online-platforms.html`
2. `OnlinePlatformsPage` 改为**读目录**，删除硬编码列表
3. Partner 侧只给「申请收录 / 提交更新」，**不给发布、不给 `displayOrder`** —— 原型见 `partner/profile.html` 的「线上平台收录」Tab
4. `recruitment-content-read.service.ts:281-292` 目前只验证自填 JSON 与自填 landingUrl 一致，**须加入 `online_platform_official` 审批表 blocker**
5. `officialDomainsJson` 每个域、`landingUrl` host、**重定向最终 host** 都必须过 T1 的同一函数

**依赖**：T1（域名校验函数）

**验收**：目录为空时 Kiosk 该入口**不显示**（不显示空列表）；机构无法自助发布；`displayOrder` 只能由 Admin 改；驳回必须回传原因。

**设计约束**：`neutralDescription` 字段名说明设计上要求平台中立——**开放机构自助发布，目录立刻变成竞价位**。

---

### T3 · 岗位来源可信度分级 🔴

**问题**：`JobsServiceHubPage.tsx:68`、`JobDetailSections.tsx:172,179` 把岗位统称「权威来源 / 来源可信」并**硬写来源类型为「线上招聘平台」**，但后端只检查审核发布状态，来源可能是 Excel、手工或学校录入。

**做什么**：投影真实 `SourceKind`（6 种），取不到显示「未标注」；「权威 / 可信」措辞需有依据才用——建议与 T1 的审批状态挂钩。

**注**：这与总账 A1/A2/A3（来源语义）是同一组，建议合并处理。

---

### T4 · 招聘会主办方归因 🔴

**问题**：`CampusTabs.tsx:141`、`FairMapPage.tsx:265`、`FairStatsPage.tsx:117` 将信息/导览/统计归因于主办方，但展区实际由**管理员接口**写入（`fair-company-zone.service.ts:109`），且 `jobs-kiosk.service.ts:326` **直接硬编码「主办方录入数据」**。

**做什么**：后端去掉硬编码归因，改为返回真实录入方；前端按真实值展示，无法确定时不归因。

---

### T5 · 「校方审核后上架」🔴（需产品先决策）

**问题**：`SmartCampusHomePage.tsx:228` 称扩展应用经「校方审核后上架」，但审核接口是**仅限管理员**的 `admin-toolbox.controller.ts:28,149`，**没有校方审批角色或记录**。

**两条路，二选一**：
- **A**：建校方审批角色与记录（较大，涉及 RBAC——注意 §2.5 N-1：现无子角色载体）
- **B**：文案收敛为「经平台审核后上架」（最小，立即可做）

✅ **产品所有者 2026-08-11 拍板采用 B，已完成**（属文案修正非新功能，由 Claude 执行）：
- 「校方审核后上架」→「经平台审核后上架」
- 副标题「本机校园模式按校方配置开放」→「按本机配置开放」
- 口径注释同步更正（否则后人会按注释改回去）

并把「校方审核」「校方配置」补进 G 组断言，反向验证：注入回归立即 FAIL。

> 若将来确实要给学校审批权，走 A 方案时需先解决 §2.5 N-1（无子角色载体），
> 届时把这两个词从断言白名单移除即可。

---

### T6 · 数据源「已连接」语义 🟠

**问题**：`jobs-shared.ts:366` 只要「已启用且最后状态非失败」即判 connected——**新建且从未同步的 Excel/手工源也显示已连接**。

**做什么**：区分 `never_synced` / `connected` / `failed` 三态；从未同步的显示「待首次同步」。

---

### T7 · 续办列表空态 🟠

**问题**：`SessionResumePage.tsx:139` 列表为空即显示「所有任务已完成」，但后端同时排除了失败、关闭、退款等状态（`member-print-orders.service.ts:169`）——**空列表不等于全部完成**。

**做什么**：空态改为「无可续办任务」，并提示可在「打印订单」查看全部状态。

---

### T8 · AI 记录聚合 🟠

**问题**：`PolicyServiceHubPage.tsx:105,137` 的「政策收藏」「AI 政策问答记录」都跳 `/me/ai-records`，但目标页只加载简历与岗位记录；**助手会话只存进程内存**（`llm-chat.service.ts:233`），重启即失。

**做什么**：要么让 `/me/ai-records` 真正聚合政策类记录（需先持久化助手会话），要么改跳转目标并说明当前不保存问答记录。

---

### T9 · 离线写队列 🟠（建议独立立项）

**问题**：`ErrorOfflinePage.tsx:76` 声称上传/订单/状态上报「排队等待、恢复后自动继续」，但该页**只轮询健康接口**，没有离线写队列或持久化重放。

**做什么**：要么实现离线队列（较大），要么改文案为「网络恢复后请重新提交」。**建议先改文案，队列独立立项**。

---

### 配套能力任务（非伪造，但同源）

| 任务 | 出处 | 说明 |
| --- | --- | --- |
| **定价 W0-1~W0-10** | [pricing 方案](../product/pricing-benefit-campaign-plan-2026-08.md) §七 | 收窄核销规则、接通用券闭环、双面价目、退款冲正等 |
| **补贴 S-1~S-6** | 同上 §4.5 + §七 | 服务端可信 `scenarioKey`、`FundingProgram`、预算预占、对账改造 |
| **双后台 AI 化** | [开发任务书](../api/console-ai-dev-spec-2026-08.md) | §4 S0 五项 + §5 设计难题（账本并发、多实例迁移） |

> ⚠️ **T1 是多个任务的公共前置**：政策链接、线上平台域名、岗位来源可信度都依赖它。
> **建议第一批只做 T1 + T2**，做完再评估其余。
