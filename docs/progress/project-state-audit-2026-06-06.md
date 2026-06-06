# 项目状态审计报告（2026-06-06）

> 审计时间：2026-06-06  
> 当前工作区：`/Users/wanglei/AI求职打印服务终端`  
> 当前分支：`codex/ai-materials-phase-a`

## 一、总体结论

项目主线能力已经覆盖 Kiosk 前台、Admin 后台、Partner 后台、API、终端 Agent 的核心骨架，并且 `main` 与 `origin/main` 当前对齐。`docs/operation-manual-benchmark-plan` 已通过 PR #20 合入 `main`。本轮已从最新 `main` 创建 `codex/ai-materials-phase-a` 分支承载产品路线文档、状态审计文档，以及 Phase A-1 资产归属底座代码。

当前最重要的产品方向不是继续平铺更多 AI 入口，而是把截图中的能力收敛成 `AI求职材料中心`：

- 简历体检、结构化解析、字段修正、优化建议、模板打印。
- 打印材料包、上传体检、A4 归一化、PII 检查。
- 面试训练、岗位适配参考、职业规划作为第二批能力。
- 企业侧招聘、候选人筛选、自动招聘机器人、岗位 JD 生成不进入项目。

## 二、Git 与分支状态

已执行 `git fetch --all --prune` 刷新远端状态。

| 项 | 状态 |
|---|---|
| `main` | `860d7a4`，与 `origin/main` 对齐 |
| 当前分支 | `codex/ai-materials-phase-a` |
| 已合入 | PR #20 `docs/operation-manual-benchmark-plan` 已合入主线 |
| 当前未提交 | 产品路线文档、状态审计文档、Phase A-1 资产归属代码与验证脚本 |
| 当前分支相对远端 | 本地新分支，尚未推送；有未提交工作区改动 |

### 本地分支分类

| 分支 | 远端状态 | 与 `main` 关系 | 建议 |
|---|---|---|---|
| `main` | 跟踪 `origin/main` | 已对齐 | 保留 |
| `docs/operation-manual-benchmark-plan` | 已推送 | 已通过 PR #20 合入 `main` | 可在 owner 确认后删除本地分支 |
| `claude/l2-4c-kiosk-auth-shell` | 已推送 | 未合入 | 待 review 或确认是否已被其他 PR 吸收 |
| `feat/p0-w1-mavis-day5-ui-polish` | 已推送 | 未合入 | 待 review |
| `feat/p0-w1-mavis-partner-dashboard` | 已推送 | 未合入 | 待 review |
| `fix/expert-audit-stage-a` | 已推送 | 未合入 | 待确认是否已由 clean 分支或 PR 吸收 |
| `fix/expert-audit-stage-b` | 远端已删除 | 未合入 | 本地遗留，需人工确认后删除 |
| `fix/expert-audit-stage-b-clean` | 跟踪 `origin/main`，ahead 1 / behind 33 | 未合入，且基线陈旧 | 不建议继续开发；如仍需该修复，应基于最新 `main` 重放 |
| 其他无远端本地分支 | 无远端 | 未合入 | 暂不删除，需 owner 确认是否保留 |

## 三、当前未完善内容

### P0 / 基础阻塞

| 事项 | 当前状态 | 影响 |
|---|---|---|
| `EndUser` 资产归属 | Phase A-1 已补 `FileObject`、`AiResumeResult`、`PrintTask` 可空 `endUserId` 关系；匿名流程继续可用 | 已解除第一层阻塞；后续仍需“我的材料”列表和材料处理域 |
| PostgreSQL 迁移 | 仍有 dev.db / migration drift 记录 | 上线前硬阻塞 |
| 真 AI provider | 多数 provider 仍为 stub | AI 体验主要是 mock / guard 能力，不能作为真实生产 AI |
| 扫描真机链路 | 当前 Kiosk 扫描仍偏演示 | 纸质简历扫描、材料扫描不能完全闭环 |
| 真实订单 / 支付域 | 订单、退款、校园卡、学生免费尚未形成真实域 | 支付、退款、优惠、校园场景不能上线 |

### P1 / 体验与运营闭环

| 事项 | 当前状态 | 影响 |
|---|---|---|
| 材料处理域 | 尚未建立 `materials/document-processing` | PII 检查、A4 归一化、材料包难以复用 |
| 简历工作区 | 尚未建立版本、字段修正、模板产物归属 | 简历优化和模板打印难以形成长期闭环 |
| Admin 异常事件时间线 | 尚未建立统一 incident timeline | 打印失败、Agent 上报、重试、改派难追踪 |
| Kiosk 生产上传方式 | 桌面验证仍用 `<input type=file>` | 真实一体机应转 Agent / U 盘 / 扫码上传 |

### 合规持续关注

- 岗位和招聘会只能做第三方/官方来源入口。
- 任何 AI 输出不得表示“代投”“录用概率”“企业筛选结果”。
- 任何简历、证件照、扫描件、材料包不得发送给企业。
- Partner 后台不得出现候选人、简历筛选、面试邀约、Offer 管理。

## 四、建议后续执行顺序

1. 提交当前 `codex/ai-materials-phase-a` 工作区改动。
2. 需要远端协作时，经用户确认后推送该分支。
3. Phase A-2：新增材料处理任务骨架，为 PII 检查、A4 归一化、材料包做底座。
4. Phase A-3：补 Kiosk “我的材料 / 我的 AI 记录 / 我的打印任务”真实读取。
5. 每个 Phase 都跑 api/kiosk typecheck、lint、build，并补运行期验证脚本。

## 五、分支处理建议

当前不建议自动删除本地分支，因为其中多条分支可能是其他模型或并行任务的工作成果。建议由 owner 确认后再清理：

- 可优先清理：远端已删除且已被新分支吸收的本地分支。
- 可暂存保留：专利、地方页面、UI polish、合作机构 dashboard 等独立工作分支。
- 必须避免：在未确认前 `git reset --hard`、`git clean` 或批量删除分支。
