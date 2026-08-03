# 实施计划

1. 使用双模型复核只读 Agent + shim 注入方案的权限边界。
2. 先编写独立 shell 回归测试，覆盖 Agent 注入、成功透传、Bash 软拒绝诊断和 Agent 工具限制。
3. 创建全局专用 `ccg-readonly-reviewer` Agent。
4. 最小修改 `agy` shim：仅在 codeagent-wrapper 场景注入 Agent，改善诊断优先级。
5. 执行回归测试、非 wrapper 透传测试和真实 Antigravity 读文件审查。
6. 安全审查变更，确认没有 shell/写/网络扩权，然后归档。
