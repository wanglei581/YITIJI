# 同步并发布 Admin 价目说明独立编辑候选 PR

## 目标

将已完成双模型终审与本地验证的 Admin `/billing` 价目说明独立编辑候选，安全同步到当前 `origin/main`，重新验证后 push 并创建 Pull Request。

## 已授权操作

- 拉取远程 Git 元数据并同步当前分支。
- 仅为解决与 `origin/main` 的 Git 集成冲突而修改必要文件。
- 重新执行相关静态门禁、typecheck、lint、带显式 HTTP 模式的生产构建与 diff 检查。
- push 当前分支并创建一个可审查的 PR。

## 允许变更范围

- Git 祖先关系与冲突解决中必要的已有文件。
- `.ccg/tasks/publish-admin-billing-description-pr/` 的任务记录（归档前不计入产品实现范围）。
- PR 标题和描述。

## 禁止事项

- 不部署、不修改生产数据库、价格、支付、env、服务或硬件状态。
- 不读取、索取、输出或输入真实密码、token、cookie、密钥。
- 不新增功能、不改业务流程、不创建账号或生产订单。
- 不 force-push，不合并 PR，不删除本 worktree 或分支。

## 验收标准

1. 当前分支以 `origin/main` 为祖先，且未带入无关冲突解决。
2. `verify:admin-billing-ui`、Admin typecheck、lint、带 `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1` 的生产构建、`git diff --check` 全部通过。
3. 双模型对同步后的 diff 审查无 Critical / Warning。
4. PR 明确说明仅为本地候选进入 CI，未部署、未修改生产说明。
