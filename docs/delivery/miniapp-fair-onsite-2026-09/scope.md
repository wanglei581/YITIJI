# Delivery Scope

## Release Boundary

- Release: miniapp-fair-onsite-2026-09
- Environment: **local** —— 只对本 worktree 的构建成立
- Revision: `eff92ac9c06392091f5b0fb18b14bf5bbeb4433d`（分支 `claude/miniapp-lane`）
  —— 建包时为 `8176c1ee2004`，之后落了 11 个提交
- Intended users/sites/devices: 微信小程序端求职者；线下场景为校园就业服务点、
  人社大厅、招聘会现场（与一体机同账号）

> `wechat-devtools`（真机/开发者工具）与 `production-api`（https://zyidai.cn）两个环境
> **从未验证过本批任何改动**。本包不得据以宣称现场闭环可用、打印可下单或版式正确。
>
> 建包后新增了 4 个页面和 1 个后端端点，**这两个环境的验证缺口一点没变**。
> 功能变多不等于验证变强 —— 所以 G3 各条一律维持 PENDING。

> **本包只是时间点快照。** 这是一个共享 worktree：分支正被另一位作者并发提交，
> 采证期间 HEAD 前进了 3 次（`ec552bb8` → `75752bdb` → `eff92ac9c`），
> 门禁跑完 2 分钟后 `utils/normalize.js` 又出现未提交在制品。
> 引用包内任何「通过」结论前，先 `git rev-parse HEAD` 与上面的 Revision 比对、
> 并 `git status --porcelain` 确认工作区干净；任一不符就在干净检出上重跑
> EV-017~EV-021、EV-024。时间线与 mtime 证据见
> `evidence/EV-022-revision-and-worktree-state.md`。

## Critical Journeys

| ID | Actor | Starting state | Intended outcome | Priority | Owner |
|---|---|---|---|---|---|
| J-01 | 求职者（已登录会员） | 在招聘会详情页 | 行前计划 → 展位导览 → 参展企业 → 生成打印文件 → print-upload 报价 → 到机出纸 | MUST | TBD |
| J-02 | 求职者（免登录） | 在政策列表 | 打开政策详情并看到来源与办事入口 | MUST | TBD |
| J-03 | 求职者（已登录会员） | 在「我的文档」 | 看到文件保存期限，并在允许范围内修改 | SHOULD | TBD |

J-01 的打印交接刚从 `403 FILE_ACCESS_DENIED` 修通（透传 `printFileUrl`），
**一次真实调用都没跑过**。J-02 的详情端点本批新补，此前一直 404。

## Committed Scope

**批 1（已完成）**：招聘会现场助手 5 页（会场导览 / 参会企业列表 / 参会企业详情 /
活动资料 / AI 参会准备单）+ 详情页四入口 + `api.js` 12 个方法。
消费的是后端早就为一体机建好、小程序从未接过的端点。

**批 2（5 项完成 4 项）**：

1. ✅ 补后端 `GET /policies/:id`（additive）
2. ✅ 死页处置：删 `job-tracker`、给 `fair-reminders` 补入口
3. ✅ 我的文档露出保存期限并允许本人修改
4. ✅ 政策条件自测轻量入口 —— 新页 `pages/policy-check`（`10dce76df`）。
   端点契约已对生产实际响应核对过（EV-009）：`method: deterministic_comparison`
   确定性比对、**非 AI**；无 `data` 信封，`utils/request.js:159` 对此的处理是对的
5. ⬜ Tab 文案修正（前提：先真删社区/早报占位）—— **仍未做**，
   `app.json` tabBar 第二项仍是「职业生活圈」

**UI 治理**：修正 `app.json` 遗留的废弃暖色身份；`app.wxss` 建立 7 级字阶；
新增视觉刻度棘轮门禁。
（更正：这三项落在 `192d5f8c7`，是**建包之前**就已完成并计入本包的内容，不是建包后的新增工作。）

**批 3（3 项，全部已提交，全部未验证）**：

1. ✅ 自我探索 · 倾向参考 —— 新页 `pages/self-explore` + 同目录 `radar.js`
   五维雷达图（`16b8e2a1b`）。后端 additive 新增 `GET /resume/self-assessment/questions`：
   小程序是原生 JS、无构建，导不进 `packages/shared` 的题库模块，
   由服务端下发**计分用的同一份题目**，从根上排除题目与计分口径漂移。
   雷达图是 canvas 绘制，**只有渲染出来才知道对不对，静态门禁覆盖不到**
2. ✅ 求职材料模板 —— 新页 `pages/job-materials`（`6730a5e3d`）。
   **全链路无 LLM**（`services/api/src/job-materials/job-materials.service.ts` 无任何模型调用），
   因此这一页刻意不挂 AI 标识、不写「AI 生成」
3. ✅ AI 简历从零生成 —— 新页 `pages/resume-build`（`75752bdb3f98`，由另一位作者实现）。
   6 段表单 + 生成/历史/导出三条链路，按 §8 拆成 page/model/view 三模块。
   **提交完成不等于验证完成**：6 段步骤条在 375px 的排布、textarea auto-height、
   受控输入是否跳光标，全部未验

**建包后另外修掉的两处诚实性缺陷**（详见 `evidence/EV-023-honesty-defect-fixes.md`）：

- 小青把 mock 降级话术当成真实 AI 回答展示（`aiGenerated` 被丢弃）—— DEF-001
- 简历诊断的 OCR 低置信度提示从未渲染（枚举被当成数字判定）—— DEF-002

两处都不是门禁报出来的，是另一路审计顺带发现的。

**`ai-records` 路由表补全**（`7796e5424`）：`generate` / `self_assessment` 补上结果页跳转；
`fair_visit_plan` **有意不接**（见 R-08）。

## Non-Goals

- 不做平台内投递、不收简历给企业、不做候选人筛选/邀约/Offer（`CLAUDE.md §2`）
- 不做材料包（Gate 0 决策 D5 延后）；不做社区动态与今日早报（后端不存在，三模型一致建议砍掉）
- **不接 `/me/pending-tasks` 做首页「下一步」** —— 数据源不匹配：它只返回一体机 PrintTask，
  `resume` 带的是一体机收银 token，而小程序是 Order-only。评审阶段判出局
- **不把求职进度上云** —— 它存着「已投递」，落服务端即违反「不记录第三方平台上的投递结果」
- **存量 47 页不做字号/圆角批量迁移** —— 无视觉验证条件下批量改是拿观感赌
- **不接招聘会数据大屏（小程序侧）** —— 后端 `FairLiveStatsDTO`
  （`packages/shared/src/types/fairDto.ts`）本来就是**为图表设计的**：
  `zoneBreakdown` 展区分布、`industryDistribution` 行业分布、`seekerIntent` 求职意向，
  另带 `dataSourceLabel`「预计/来源数据 · 非实时」统一标注口径，
  并明确约定 `null` 表示无可证明统计源、前端必须渲染「暂无数据」而不是 0（同 R-01）。
  Kiosk 侧已有 `FairDataScreen` 消费它；小程序 `utils/api.js` 也已有
  `getFairStats`（`GET /job-fairs/:id/stats`）——但**零个页面调用它**。
  **不接的原因不是技术问题，是生产库里招聘会 0 条**（EV-009 只读探测），
  现在做就是一个永远空的图。等生产有招聘会内容后可直接接，
  合规的图表数据结构与 `null` 语义已经备好。登记在 RISK-005，
  写下来是为了避免后来人重新发现一遍

## Rules And States

| ID | Journey | Rule/state | Normal behavior | Failure/recovery behavior | Authority |
|---|---|---|---|---|---|
| R-01 | J-01 | 统计字段为 `null` | 显示「暂无数据」 | **不得显示 0** —— 「0 个展位」与「不知道有几个展位」是两回事 | 不伪造能力（CLAUDE.md §9） |
| R-02 | J-01 | 拿到打印文件响应 | 文案只说「生成并去打印」 | **不得声称已打印**；出纸要到机核销后才发生 | CLAUDE.md §9 |
| R-03 | J-01 | 招聘会不存在或未发布 | 后端返回 200 空集（非 404） | 前端分不出两种成因，空态并列说明「可能未录入，也可能已下线」，**不替主办方作证** | grok 计划评审 |
| R-04 | J-01 | `localRecords` | 只陈述「打开过来源投递入口」 | `requiresLogin` 时说「未登录，无法关联你的记录」，**不是「无记录」** | compliance-boundary §4.4 |
| R-05 | J-01 | 字段缺失（`applyNote` / `checkinStatus` / `boothCount`） | 保持缺失，页面按「暂无」渲染 | **不跟一体机在客户端硬编造值** | utils/normalize.js |
| R-06 | J-03 | 延长保存（`months_6` / `long_term`） | 先出示条款，用户确认后才带 `consentVersion` | 默认补版本号等于替用户签字；锁死的文件不出修改入口 | retention-policy.ts |
| R-07 | J-01/J-02 | 外链动作文案 | 只用白名单词 | 小程序打不开任意外链，实际用「复制来源链接」；**禁「一键投递/立即投递/内推」** | CLAUDE.md §2 |
| R-08 | J-01 | `ai-records` 里的「招聘会规划」记录 | **有意不给跳转**，改为说明「要从对应的那场招聘会进入」 | `fair-visit-plan` 页取数要 `?fairId=`，而 `/me/ai-records` 只 select 了 id/taskId/kind、**不带招聘会标识**。硬接上会点进「缺少招聘会参数」——比诚实说明更糟。等后端记录带上 fairId 再接 | pages/ai-records/ai-records.js |
| R-09 | 全站 | AI 回答与 OCR 识别结果 | 服务端 `aiGenerated` / `extractionNotice.confidence` 必须被消费并向用户披露 | 降级话术不得与真实模型回答同形展示；非 `high` 置信度必须提醒人工复核。两处都曾静默失效（DEF-001 / DEF-002） | CLAUDE.md §9 不伪造能力 |

## Dependencies

| Dependency | Demo/test state | Live state | Owner | Failure behavior | Evidence |
|---|---|---|---|---|---|
| `services/api`（同仓） | typecheck 0 error（含本批第二个 additive 端点 `GET /resume/self-assessment/questions`） | 未部署本批改动 | TBD | 端点缺失时契约门禁报 BROKEN | EV-021 |
| 生产 API `https://zyidai.cn` | 公开只读端点已探测 | **业务闭环未验证**：库里岗位/招聘会/政策/终端全为 0 条 | TBD | 无内容 ⇒ 现场助手一步都走不到 | EV-009 / RISK-001 |
| 微信开发者工具 / 真机 | 无环境 | **未验证** | 产品负责人 | 未知 | EV-008（PENDING）/ EV-025 |
| 微信平台（合法域名） | 未涉及 | 未知 | TBD | `downloadFile` 域名若未配置，资料预览必失败 | 未查证 · RISK-002 |
| CI（GitHub Actions） | 门禁已进执行闭包 371/377 | **本分支从未推送、从未在 CI 上跑过** | TBD | 曾会在 Repository integrity gate 直接转红（DEF-004） | EV-024 |

## Change Control

Changes after G1 approval must identify affected rules, implementation, verification, release, and evidence before approval.

本 lane 的附加约束：

- 小程序 lane 独占 `apps/miniapp/**`；`services/api` 与 `packages/shared` **只加不改**
- `docs/progress/*.md` 冲突高发，对方有未提交改动时跳过，结论先落 `apps/miniapp/README.md`
- `.github/workflows/**` 默认不改；新增门禁一律挂进 `apps/miniapp` 的 `verify:static` 链
- 四条自动门禁（static / pickup-qrcode / api-contract / visual-scale）任一转红即停止推进
- **挂链必须用 `pnpm run` 而不是 `node ... && node ...`** ——
  `verify-ci-gate-coverage.mjs` 的执行闭包展开器只跟踪 pnpm/npm 调用，
  用 node 直串会让门禁「在跑但覆盖率看不见」，进 CI 直接红（DEF-004）。
  新增门禁脚本名后必须补跑 `node scripts/verify-ci-gate-coverage.mjs`
- 新增或改动任何 `api.js` 调用后必须跑 `contract:update --write` 再重跑契约门禁（DEF-005）
