# Antigravity 调用故障诊断

## 结论

- Antigravity 账号、OAuth、模型可用性和网络均正常。
- 失败的复杂审查已成功创建会话并收到 `streamGenerateContent` 响应，真正中断点是 `agy -p` 无交互模式在模型请求 `Bash` 时执行 `soft-denying tool confirmation`。
- `admin controls not applicable` 是消费者账号查询企业管理控制时的启动噪声；成功调用也会出现，不是本次根因。
- `WaitForReady failed: context deadline exceeded` 在后续仍然出现有效模型流时是可恢复启动超时，也不是本次终止原因。
- `~/.local/bin/agy` 是自定义 shim。当真实 CLI 无 stdout 时，它会从整份日志抓取启动阶段的账号告警，但未识别后续 OAuth 成功和 Bash 软拒绝，因而误报为账号、资格或配额问题。

## 复现与对照

- `agy` 版本：`1.1.7`；Antigravity Desktop：`2.3.1`。
- `codeagent-wrapper --backend antigravity "只回复 OK"` 成功。
- 明确禁止工具、只依据随附证据的结构化审查成功。
- 两次失败审查均显示 OAuth 成功、选中 `Gemini 3.6 Flash (High)`、创建会话、收到模型流，然后在第 3 步 Bash 工具确认处被软拒绝。

## 推荐修复

1. 立即可用：对不需要 Antigravity 自行读仓的审查，在提示词中明确禁止所有工具，由 Codex 提供差异、测试和部署证据。
2. 长期首选：创建专用只读 Antigravity reviewer agent，只开放 `read_file` / `grep_search`，不提供 `run_command`，由 shim 在 codeagent-wrapper 场景下注入 `--agent`。
3. 备选：在 `~/.gemini/antigravity-cli/settings.json` 中仅 allowlist 明确的只读命令前缀，不要设置 `command(*)`。
4. 修复 shim 诊断：OAuth 后过滤启动阶段 `not logged in`，将 `admin controls not applicable` 标记为非致命，优先报告 `soft-denying tool confirmation` 及被拒绝的工具。

## 不推荐

- 不建议全局启用 `--dangerously-skip-permissions`或 `command(*)`；它们会破坏 Antigravity 只读审查边界。
- 不需要因本次问题重新登录、更换账号或调整配额。

## 官方依据

- https://antigravity.google/docs/cli/permissions
- https://antigravity.google/docs/cli-using
- https://antigravity.google/docs/subagents
