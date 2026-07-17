# 开发状态全盘点与收口建议（2026-07-17）

> 只读盘点报告。证据基线：`origin/main@5153bbb1`（盘点期间 PR #277 刚合入）；`gh pr list/checks`、`git branch -r`（119 条远程分支）、`git worktree list`（167 个 worktree）、`docs/progress/next-tasks.md` 与 `current-progress.md`（均取 origin/main 版本）。本报告不合并/不关闭任何 PR、不删任何分支或 worktree。

## 一、开放 PR 一览（共 15 个）

| PR | 主题 | 分支 | CI（双 job） | 落后 main | 判断 / 建议动作 |
|----|------|------|--------------|-----------|------------------|
| #279 | docs: 用户中心 closure plan 状态校准 | codex/user-center-commercial-closure-plan-20260717 | 无 checks | 新建 | **CONFLICTING**；活跃 Codex 会话刚开（11:01Z），由该会话解冲突收口，本盘点不干预 |
| #278 | docs: 75 屏原型归档 + 后台双端规划 + 任务池 | claude/lucid-kilby-0199ed | 无 checks | 落后 8 / 领先 4 | **CONFLICTING**（冲突文件：`docs/progress/current-progress.md`、`next-tasks.md`，merge-tree 证实）；**待修：rebase 解 SSOT 冲突后尽早合入**（开工基线依赖） |
| #269 | docs: 用户中心计划状态校准（07-16 版） | codex/user-center-plan-status-reconcile-20260716 | pass | 落后 7 | **疑似过时**：同名 r2 版已由 PR #274 合入 main；但对 main 仍有 12 文件 +169 行差异（含审计文档），需人工决策：确认残余增量有价值则 rebase 合并，否则关闭 |
| #268 | docs: 记录 admin 手机号转移合并 | codex/admin-phone-transfer-postmerge-status-20260716 | pass | 落后 19 | 小 docs（5 文件 +15 行），记录 #266 合并事实；**可合并**（合并前确认与 SSOT 最新版无语义重复） |
| #254 | fix(auth): admin 首绑 release candidate（Draft） | codex/admin-initial-phone-binding-production-release-20260715 | pass | base 非 main（codex/release-base-6c2a9668） | **疑似过时**：next-tasks 明示「旧 PR #254 不可作为部署来源」，且后继 #256 已 MERGED；**建议用户关闭** |
| #253 | chore(release): strict scan-health 部署候选认证（Draft） | codex/release-strict-scan-health-20260715 | pass | — | 发布认证类；F1 生产仍 NO-GO 语境下**需用户拍板**去留 |
| #243 | docs: 记录 PR#230 被 #241 取代 | docs/record-pr230-superseded-by-pr241 | pass | 落后 135 | 仅 +2 行 current-progress；**可合并**（低风险），或确认已被后续记录覆盖则关闭 |
| #239 | fix: ready 打印机心跳视为健康 | codex/fix-terminal-ready-alert-20260714 | pass | 落后 142 | 运行时修复（41 行，含 printer-status）；**需人工决策**：确认告警语义仍需要后 rebase 重跑 CI 再合 |
| #224 | 证件照打印 MVP（裁剪+A4 排版+彩打契约） | feature/id-photo-design | 无 checks | 落后 392 / 领先 25 | 对应任务池「首期证件复印与证件照」未完成项；**需用户拍板优先级**，若继续则 rebase + 补 CI |
| #210 | fix: job fit 匿名授权 UI（Draft） | codex/job-fit-anonymous-consent-ui-fix-20260712 | pass | — | **疑似被取代**：next-tasks 记载 K2a 岗位匹配匿名授权恢复已在 LightFlow 本地候选完成；待核实后关闭或并入 |
| #196 | C5-6 退款端到端回归门禁 + SOP + FREE_MODE 决策 | feature/payment-c5-6-refund-regression-gate | pass | 落后 401 | next-tasks §C5-6 明示该门禁「未合 main」；**可合并候选**：rebase 重跑 CI 后合入（纯新增 verify + SOP 文档，不改运行时） |
| #195 | fix: 打印重试退款协调加固（Draft） | codex/print-scan-admin-ops-review-fixes-20260712 | pass | — | **待核实**是否已被 W-B/W-C 退款收敛与 #192 结算一致性吸收；由用户/支付域负责人决策 |
| #188 | docs: 修正 print URL 契约状态 | codex/docs-printfileurl-status-correction-20260712 | pass | 落后 430 | 仅 2 行；next-tasks 对应条目已被同日「动态无出纸验收」覆盖注记；**疑似过时**，低风险合并或关闭均可 |
| #117 | 岗位大师 M1+M1.5（Draft，远端备份） | feature/job-master | 无 checks | — | **保持 Draft 冻结**（记忆约束：截图补齐前勿 rebase/勿转 Ready/勿删 backup）；M1.5 功能本体已经 PR #200 另路合入 |
| #116 | 我的订单失败原因安全回显 | claude/jovial-bassi-53427d | pass（旧） | 落后 717 | 对应任务池「失败原因本人可见范围仍独立确认」；**需人工决策**：确认口径后 rebase 重验，否则关闭 |

状态分布：可合并/低风险 docs 3（#268/#243/#188）；待修冲突 2（#278/#279）；可合并候选（需 rebase 重验）1（#196）；疑似过时/需用户拍板 8（#254/#253/#269/#210/#195/#239/#224/#116）；冻结 1（#117）。

## 二、进行中事项 vs 实际状态对照

| 声明进行中/待办事项（next-tasks / current-progress） | 对应 PR / 分支 | 实际状态与卡点 |
|---|---|---|
| Wave 1-B Slice 2 导出执行器与恢复策略（`[~]` 方案本地候选） | worktree `.worktrees/user-center-wave1b-slice2-plan-20260717`（未 push） | 方案已锁定、Claude 审查有效；**卡点：尚未建远程分支/PR**，且必须从最新 main 开新分支 |
| Wave 1-C Admin 隐私运营 UI / Wave 2–5 | 无 | 按序未开工（依赖 Slice 2 真实执行器） |
| Admin 严格首次手机号绑定发布（next-tasks 写「PR #256 待 push 重跑 CI」） | PR #256 | **文档滞后**：#256 实际已 MERGED（gh 证实）；待核实合入内容是否含最新并发锁修订，并更新 SSOT；生产部署仍须 G1-R 单独授权 |
| Partner 账号安全移除（next-tasks 写「PR #267 尚未合入」） | PR #267 | **文档滞后**：#267 实际已 MERGED；剩余卡点 = 目标 PostgreSQL `migrate deploy` + 真实并发删除验收（须另行授权） |
| F1 发布 provenance / release runtime contract | #262、#277 均已 MERGED | 代码全部进主线；**生产 F1 维持 NO-GO**，首次启用与回滚演练须单独生产授权 |
| FREE_MODE 价目说明诚实化（next-tasks 写「#247 未合并」） | PR #247 | **文档滞后**：#247 已 MERGED；卡点 = 部署 + 生产授权修改两条 description |
| C5-6 退款回归门禁 + SOP（标 `[x]` 但注明未合 main） | PR #196（open） | CI 绿；卡点 = rebase（落后 401）+ 重跑 CI + 合并决策 |
| 未支付任务受控关闭（「下一步提交 PR」） | 未见对应开放 PR | **卡点：PR 未创建**（#195 是另一主题，勿混淆） |
| 青序 LightFlow K1/K2 整合候选 | worktree `qingxu-lightflow-integration-20260714`（未 push） | 卡点 = 用户确认视觉后才 push/PR；K3–K6 波次未开工 |
| 打印扫描：真实扫描（`[~]`） | `feature/real-scan`（未合并） | 卡点 = 合并决策 + Windows 真机 SMB 链路验收 |
| 打印扫描：证件照 / 材料包 / Admin 运营后台 | #224（证件照）/ 无 / 无 | 证件照有 PR 但严重落后；材料包、Admin 商业化后台未开工 |
| Windows 真机补验（PDF/图片/异常场景/扫描） | `codex/print-scan-windows-acceptance@0aa97b8` | 卡点 = 现场执行（非代码） |
| Partner 相对 API URL 解析修复 | 无 | 未开工（已登记为独立任务） |
| 依赖 P1 低/中危（esbuild/babel/js-yaml） | 无 | 未开工，另起最小任务 |
| cloud_upload ②盘点 ④移除 | 脚本已合入 | 卡点 = 需有生产库权限者执行只读盘点 |

## 三、收口顺序建议

1. **先清 docs SSOT 通道（本周内）**：① 让活跃 Codex 会话收口 #279（它与 #278 改同一批 progress 文档）；② 合并小记录类 #268、#243（低风险）；③ 决策 #269（疑似被 #274 取代）与 #188 的去留。理由：所有 docs PR 都在抢 `current-progress.md` / `next-tasks.md` 两个 SSOT，串行处理避免反复冲突。
2. **#278 rebase 解冲突后尽早合入**：75 屏原型定稿 + 开发任务池是 Kiosk 前端 1:1 开发的开工基准，越晚合冲突越大（冲突面已证实仅在两个 progress 文档 + .ccg 归档，属可机械解决的追加型冲突）。
3. **顺手修正 SSOT 滞后事实**（可并入 #278 或 #279 的 rebase）：#256、#267、#247 已 MERGED 但 next-tasks 仍写「待 CI / 未合入 / 未合并」，须更新为「已合入未部署」，否则后续会话会重复排队。
4. **代码类 PR 分批拍板**：#196（建议合，纯门禁+文档）→ #239（确认告警语义）→ #116（确认失败原因口径）→ #224（证件照，拍板是否本期做）；#254 建议关闭，#253/#210/#195 由用户确认是否已被取代；#117 维持冻结不动。
5. **需用户拍板的事项**：#254 关闭、#253 去留、#269/#188/#210/#195 取舍、#224/#116/#239 优先级、LightFlow 整合候选的视觉确认、`feature/real-scan` 合并窗口。

**开工基线成立条件**：完成第 1–3 步（#279、#278 及 docs 记录类收口 + SSOT 滞后修正）后，「从最新 main 拉分支开发 Kiosk 75 屏原型 / Wave 1-B Slice 2」的前提即成立；第 4 步代码类 PR 不阻塞开工，可并行拍板。167 个 worktree 与 119 条远程分支中大量为历史任务残留（多数 tip 已被 main 覆盖或属只读证据），**仅登记不建议删除**，处置权在用户；受保护项（job-master、job-fit-m1-5、print-format-conversion-design locked 等）不得触碰。

> 待核实项：#269 残余 +169 行的具体价值；#195/#210 是否被后续合并吸收；#116 所需口径确认；「未支付任务受控关闭」候选分支的当前位置。以上均未在本轮下结论。
