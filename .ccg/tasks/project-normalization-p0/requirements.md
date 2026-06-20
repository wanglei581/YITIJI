# 项目规范化 P0 需求

## 目标

在干净 `origin/main` 基线上建立项目规范化的第一批可执行基线，后续所有治理、清理、重构和业务闭环开发都按“一任务一分支一文件预算一验证门”的方式推进。

## 非目标

- 不新建 Git 仓库。
- 不搬迁 `apps/`、`services/`、`packages/`。
- 不重写 Kiosk/Admin/Partner 页面。
- 不改 auth、DB、crypto、生产门禁、Terminal Agent、打印扫描链路。
- 不清空当前主工作区的未跟踪文件。
- 不使用 `git add .`。

## 本批允许修改

- `.ccg/tasks/project-normalization-p0/`
- `.ccg/spec/guides/index.md`
- `docs/project-structure.md`
- `docs/reviews/project-normalization-p0-worktree-inventory.md`
- `docs/superpowers/plans/2026-06-20-project-normalization-p0.md`
- `AGENTS.md`

## 验收标准

- 新治理分支基于最新 `origin/main`。
- 当前主工作区不被修改。
- 文档明确现有仓库继续使用，不新建仓库。
- 文档明确物理迁移后置。
- 文档明确本地混乱项的分类规则。
- `git diff --check` 通过。
- 本批不触碰运行时代码。
