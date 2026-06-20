# AI 简历资产中心：我的简历动作 hardening

> 日期：2026-06-21
> 分支：`codex/me-resumes-actions-hardening`
> 范围：Kiosk 前端 `/me/resumes` 动作恢复。

## 目标

让「我的简历」中的四类动作通过 `taskId + member token` 可恢复：

- 查看诊断报告。
- 查看 / 继续生成优化版。
- 查看最近一次岗位匹配参考，或在无历史记录时重新分析。
- 查看并打印 AI 生成简历预览。

## 边界

- 不新增后端接口。
- 不在 `/me/resumes` 展示简历原文、诊断正文或 payload。
- 不新增平台内投递、企业收简历或候选人管理能力。
- 不猜测缺失的岗位内部 id。

## 结论

- `/me/resumes` 已将动作跳转升级为 `location.state.taskId + ?taskId=` 双通道，刷新后仍能恢复目标任务。
- 报告、优化、岗位匹配页面已避免把显式会员 `taskId` 与残留匿名 `accessToken` 串用。
- 岗位匹配页面已复用已有 `getLatestJobFit` 回看 completed 历史结果；失败、过期、非本人或无历史记录时回到选岗/手填入口。
- 生成预览页已支持 query taskId 初始化读取态，避免刷新时先显示“结果已清除”的误导空态。

## 审查裁决

双模型复审中，Antigravity 提醒回看态无法展示「去来源平台投递」按钮。核对类型后确认 `JobFitResponse.job` 没有内部 `id`，不能安全恢复 `/jobs/:id`；当前保留降级为「换个岗位分析」。后续如需回看态来源跳转，需后端返回内部岗位 id 或新增受控外部跳转记录动作。

## 验证

- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`
- `pnpm --filter @ai-job-print/api verify:member-assets-c2d`

以上命令均通过；lint 仍有既有 `KioskBusyContext.tsx` fast-refresh warning，build 仍有既有 large chunk warning。
