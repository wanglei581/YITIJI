# 招聘会与校园招聘闭环准入审查记录

## 审查输入

- 正式文档：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`、`docs/compliance/compliance-boundary.md`、`docs/product/feature-scope.md`、`.ccg/spec/guides/index.md`、`docs/project-structure.md`。
- Kiosk 代码：`JobFairsPage.tsx`、`JobFairDetailPage.tsx`、`FairCompanyDetailPage.tsx`、`CampusPage.tsx`、`jobFairs.ts`、路由表。
- API 代码：`JobsController`、`JobsService`、`AdminFairsController`、`AdminFairsService`、`activity.types.ts`、`activity.service.ts`。
- Verify：`verify:jobfair-review`、`verify:admin-fairs`、`verify:jobfair-campus-priority`、`verify:partner-edit`、`verify:partner-smart-campus`。

## 双模型结论

Claude 与 Antigravity 均确认可以推进下一组业务闭环，但必须拆分为独立分支。

共同结论：

- 不得新增平台内投递、报名凭证、签到、入场券、候选人管理或企业招聘闭环。
- `FairCompanyDetailPage` 缺真实二维码与外部跳转记录，且不能用 `company_profile` 或 `job_fair` 凑类型。
- 页面体积超限是明确工程风险。

分歧与裁决：

- Antigravity 建议先做页面拆分；Claude 指出 `JobFairsPage` 本校优先接线是最低风险且不触碰超限页面的首个 runtime 缺口。
- 源码复核确认 `CampusPage` 已传 `terminalId`，`JobFairsPage` 未传。因此最终采用：先做 `JobFairsPage` 最小接线，再做 `fair_company` activity target，页面拆分作为独立质量分支。

## 最终输出

- `docs/reviews/jobfair-campus-closure-admission.md`
- `docs/superpowers/plans/2026-06-21-jobfair-campus-closure.md`

## 后续任务

1. `codex/jobfairs-list-terminal-priority`：纯前端最小接线。
2. `codex/fair-company-external-jump-logs`：新增 `fair_company` 外部跳转记录，必须双模型审查。
3. `codex/jobfair-pages-size-split`：大页面零行为拆分，必须双模型审查。

## 本分支结论

本分支为 docs-only 准入审查分支，可提交；不替代后续 runtime 分支验证。

## 最终复审修正

提交前再次调用 Claude + Antigravity 审查实际文档 diff：

- Critical：无。
- Antigravity：Approve。
- Claude：Approve，但指出 Branch 2 中 `packages/shared/src/types/memberAssets.ts` 是 Kiosk `ActivityTargetType` 的类型来源，不能标为可选。

已修正：

- `docs/reviews/jobfair-campus-closure-admission.md` 将 `packages/shared/src/types/memberAssets.ts` 列为 Branch 2 必改文件。
- `docs/superpowers/plans/2026-06-21-jobfair-campus-closure.md` 将 shared 类型同步列为必改，并补充“后端枚举与 shared 枚举必须同步，否则前端 typecheck 失败”。
