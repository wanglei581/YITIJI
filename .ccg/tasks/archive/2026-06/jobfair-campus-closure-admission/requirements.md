# 招聘会与校园招聘闭环准入审查

## 目标

- 基于当前 `main` 的真实代码和文档，审查招聘会 / 校园招聘下一组业务闭环是否可以推进。
- 明确已有能力、真实缺口、合规红线、文件预算和验证命令。
- 输出首批独立分支任务，不在本分支直接修改运行时代码。

## 非目标

- 不实现招聘会 / 校园招聘 runtime 功能。
- 不新增入口、路由、页面、API 或数据库字段。
- 不修改 Admin / Partner / Kiosk 现有业务行为。
- 不合入报名、签到、入场券、投递结果、候选人管理或企业招聘闭环。

## 允许修改文件

- `docs/reviews/jobfair-campus-closure-admission.md`
- `docs/superpowers/plans/2026-06-21-jobfair-campus-closure.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/jobfair-campus-closure-admission/*`

## 验证方式

- 读取正式入口文档和相关源码。
- Claude + Antigravity 双模型准入审查。
- `git diff --check`。
- 本分支为 docs-only，runtime 验证留给后续独立分支。
