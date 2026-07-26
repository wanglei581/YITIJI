# 需求与范围

## 目标

使 `codeagent-wrapper --backend antigravity` 的审查调用在无交互模式下保持严格只读，不再因 Bash 权限确认而空输出；同时让 shim 报告真实中断点，不再将非致命的启动告警误报为账号问题。

## 用户旅程

作为 Codex/CCG 编排器，我希望调用专用 Antigravity 只读 reviewer，以便它能读取和搜索工作区并输出审查，但永远不能执行 shell、写文件或访问网络。

## 允许修改

- `/Users/wanglei/.local/bin/agy`
- `/Users/wanglei/.gemini/config/agents/ccg-readonly-reviewer/agent.md`
- `.ccg/tasks/fix-antigravity-readonly-reviewer-20260726/*`

## 禁止

- 不修改 `agy.real`、Antigravity Desktop 或账号凭据。
- 不开启 `--dangerously-skip-permissions`、`command(*)`、`run_command`、写工具或网络工具。
- 不修改项目业务代码、生产配置或远端资源。

## 验收

- 回归测试经历 RED → GREEN。
- wrapper/CCG 调用时 shim 自动注入专用 reviewer Agent；Agent 缺失或试图改用其他 Agent 时失败关闭。
- Agent 工具集仅包含只读文件/搜索工具。
- 真实 Antigravity 审查能自主读取工作区中的已知文件并输出结构化结果。
- 越权请求（shell、写文件、网络、越界读取）不触发交互确认，并能返回可用的拒绝/审查文本。
- 构造的 Bash 软拒绝日志被准确诊断，不再建议修复账号/资格/配额。
