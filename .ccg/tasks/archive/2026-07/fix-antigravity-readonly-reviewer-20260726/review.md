# 最终审查记录

## 结论

- Antigravity 最终复审：`APPROVE`，100/100，无 Critical / Warning。
- Claude 最终复审：`APPROVE`，无 Critical / Warning。
- 只读 Agent 硬工具集为 `view_file` / `grep_search`，`commandExecutionPolicy: off`。

## 已修复审查项

1. wrapper 场景强制注入 `ccg-readonly-reviewer`；Agent 缺失、非只读 Agent、重复或缺值参数均失败关闭。
2. 拒绝 `--dangerously-skip-permissions`、`--mode`、交互模式、会话续接和项目切换参数。
3. `--add-dir` 必须物理解析为当前工作区，防止越界目录或符号链接绕过。
4. 自动日志改用 `mktemp` 随机独占路径，权限为 `0600`；成功日志清理，失败日志保留诊断。
5. 面向用户的错误摘要仅输出固定分类，不回显原始日志行、邮箱或 token；成功路径不透传诊断 stderr。
6. 空模型报告改为可读诊断并非零退出，不再误报为账号、资格或配额问题。

## 验证证据

- `bash -n ~/.local/bin/agy`：通过。
- shell 回归套件：通过，包含 RED → GREEN，参数失败关闭、PII 脱敏、日志权限和成功日志清理。
- 真实 Antigravity E2E：成功读取 `engines.node = >=22.13 <23` 并搜索 `packageManager = pnpm@11.2.2`。
- 真实边界 E2E：拒绝 shell、写文件、网络、`/etc/hosts`、`schedule` 和 `send_message`；哨兵文件不存在。
- `/Users/wanglei/.local/bin/agy --version`：`1.1.7`；`agy.real agents` 可列出 `ccg-readonly-reviewer`。

## 剩余边界

- 直接人工 `agy` 调用按需求保持原样透传；只读强制只作用于 wrapper / CCG Role 场景。
- CLI 运行时仍会暴露平台生命周期工具 `schedule` / `send_message`，它们未写入 Agent 工具列表，且系统提示明确禁止；真实 E2E 已验证拒绝。
