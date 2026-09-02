# Delivery Scope

## Release Boundary

- Release: miniapp-fair-onsite-2026-09
- Environment: **local** —— 只对本 worktree 的构建成立
- Revision: `8176c1ee200494b4f59e59b9ffdbbe4696d8b4d1`（分支 `claude/miniapp-lane`）
- Intended users/sites/devices: 微信小程序端求职者；线下场景为校园就业服务点、
  人社大厅、招聘会现场（与一体机同账号）

> `wechat-devtools`（真机/开发者工具）与 `production-api`（https://zyidai.cn）两个环境
> **从未验证过本批任何改动**。本包不得据以宣称现场闭环可用、打印可下单或版式正确。

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

**批 2（进行中，5 项完成 3 项）**：

1. ✅ 补后端 `GET /policies/:id`（唯一后端新增，additive）
2. ✅ 死页处置：删 `job-tracker`、给 `fair-reminders` 补入口
3. ✅ 我的文档露出保存期限并允许本人修改
4. ⬜ 政策资格自测轻量入口
5. ⬜ Tab 文案修正（前提：先真删社区/早报占位）

**UI 治理（本批附带）**：修正 `app.json` 遗留的废弃暖色身份；`app.wxss` 建立 7 级字阶；
新增视觉刻度棘轮门禁。

## Non-Goals

- 不做平台内投递、不收简历给企业、不做候选人筛选/邀约/Offer（`CLAUDE.md §2`）
- 不做材料包（Gate 0 决策 D5 延后）；不做社区动态与今日早报（后端不存在，三模型一致建议砍掉）
- **不接 `/me/pending-tasks` 做首页「下一步」** —— 数据源不匹配：它只返回一体机 PrintTask，
  `resume` 带的是一体机收银 token，而小程序是 Order-only。评审阶段判出局
- **不把求职进度上云** —— 它存着「已投递」，落服务端即违反「不记录第三方平台上的投递结果」
- **存量 47 页不做字号/圆角批量迁移** —— 无视觉验证条件下批量改是拿观感赌

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

## Dependencies

| Dependency | Demo/test state | Live state | Owner | Failure behavior | Evidence |
|---|---|---|---|---|---|
| `services/api`（同仓） | typecheck 0 error | 未部署本批改动 | TBD | 端点缺失时契约门禁报 BROKEN | EV-005 |
| 生产 API `https://zyidai.cn` | 未接触 | **未验证** | TBD | 未知 | EV-009（PENDING） |
| 微信开发者工具 / 真机 | 无环境 | **未验证** | 产品负责人 | 未知 | EV-008（PENDING） |
| 微信平台（合法域名） | 未涉及 | 未知 | TBD | `downloadFile` 域名若未配置，资料预览必失败 | 未查证 |

## Change Control

Changes after G1 approval must identify affected rules, implementation, verification, release, and evidence before approval.

本 lane 的附加约束：

- 小程序 lane 独占 `apps/miniapp/**`；`services/api` 与 `packages/shared` **只加不改**
- `docs/progress/*.md` 冲突高发，对方有未提交改动时跳过，结论先落 `apps/miniapp/README.md`
- `.github/workflows/**` 默认不改；新增门禁一律挂进 `apps/miniapp` 的 `verify:static` 链
- 四条自动门禁（static / pickup-qrcode / api-contract / visual-scale）任一转红即停止推进
