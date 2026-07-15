# 管理员安全修改密码实施计划

## 方案选择

复用已存在且通过 CI 的 PR #230，不重新发明实现。由于原分支落后 `origin/main` 107 个提交并处于冲突状态，在最新 `origin/main` 的独立 worktree 中只重放两次功能提交：

1. `2d6426b2 feat(admin): 登录态自助改密 + 账号设置页`
2. `77a83772 fix(auth): harden change-password against race/brute-force/truncation`

不直接使用旧分支 tip，不带入其历史合并提交或其他功能。

## 步骤

1. 基线：安装依赖，记录最新 main 状态，运行相关现有 typecheck/verify 的最小基线。
2. TDD 证据：先确认候选提交的验证脚本在未实现的 main 上失败或不存在，再重放功能提交。
3. 集成：解决与最新 main 的冲突，仅限 requirements.md 文件预算。
4. 验证：运行 `verify:change-password`、API/Admin typecheck、Admin lint/build、内部认证与审计回归。
5. UX 复核：确认顶栏只有一个账号设置入口，页面不占侧栏、不与现有退出入口冲突；成功后清会话回登录。
6. 安全审查：子代理规格审查、代码质量审查；Antigravity + Claude 并行审查完整 diff。
7. 收口：修复 Critical/High，重新验证；同步正式进度文档，产出本地可部署候选，但不 push/部署。

## 回滚边界

- 本地回滚只需丢弃本分支；不修改现有旧 PR #230 分支和其 worktree。
- 无数据库迁移，部署回滚不涉及 schema。
- 生产密码轮换必须在后续单独获批部署后，由用户本人通过 UI 输入；聊天中不传递新密码。
