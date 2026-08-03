# 方案复核

## 双模型结论

- Antigravity：`APPROVE`，无 Critical；建议覆盖父进程检测、Agent 缺失、敏感文件和越权请求。
- Claude：`REQUEST_CHANGES`，要求只读安全属性失败关闭，实测缺席工具和只读工具的无交互行为，收窄诊断匹配。

## 采纳后设计

1. wrapper 识别不只看直接父进程，同时检查有限祖先链、显式测试开关和注入的 CCG Role 标记。
2. 一旦判定为 wrapper/CCG 调用：
   - Agent 定义不存在时立即失败；
   - 显式传入非 `ccg-readonly-reviewer` Agent 时立即失败；
   - 不允许回落到默认全权 Agent。
3. 直接人工调用 `agy` 不注入 Agent，保持原行为。
4. Agent 硬工具集仅 `view_file` / `grep_search`，`commandExecutionPolicy: off`；提示层额外禁止敏感文件、shell、写入和网络。本机 CLI 1.1.7 对 `read_file` 无 converter，已由真实 E2E 确认必须使用 `view_file`。
5. 诊断保留原始日志，只在面向用户的摘要中调整优先级；精确匹配 `admin controls not applicable`，不泛化忽略其他管控失败。
