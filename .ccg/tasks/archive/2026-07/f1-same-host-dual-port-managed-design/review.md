# F1 同机双端口 Managed 发布拓扑设计审查

## 结论

- Claude：`APPROVE`；Critical 0。提出 3 项非阻塞 Warning，其中测试语义与 legacy Nginx 恢复基线已吸收；设计/代码 `3011` 与当前 runbook/代码 `3010` 的窗口期继续以 NO-GO 管控。
- Antigravity：`APPROVE`；Critical 0、Warning 0、Info 2。确认 SSRF、共享数据平面、同机非 HA、D5 回滚边界与分层授权完整。
- Cursor Agent CLI：`APPROVE`；Critical 0、Warning 2。两项均指向后续 D1′：同步 runbook/B1–B9，并把 B1.1/B1.3 从独立主机口径修订为同机双端口隔离证明。
- Codex：接受三方共同结论；未发现阻塞设计写入和用户审阅的问题。

## 已吸收意见

1. §4.3 明确 URL 负例只是证明单一字符串全等拒绝，不得诱导实现 URL 解析器。
2. §9/§10 明确 D3 必须先固定有效 legacy Nginx 配置的脱敏摘要，作为 D5 在 `CUTOVER_CONFIRMED` 前唯一批准的恢复目标。

## 留给 D1′ 实施计划的阻塞项

1. 代码 health URL 仍固定 `3010`；必须精确改为唯一 managed `3011` 并补正负例。
2. production runbook、D3 B1.1/B1.2/B1.3、旧实施计划仍保留独立主机 / managed `3010` 口径；在全部同步并复审前维持 NO-GO。
3. 新 D2′ 必须覆盖同机 `3010/3011`、独立 `PM2_HOME`、Nginx 全切或不切、配置校验失败、资源争用和 managed-only rollback。

## 边界

本审查只覆盖设计文档和进度 SSOT；没有连接生产、没有修改运行时代码、没有执行 SSH/PM2/Nginx/Genesis/activation/迁移/seed/切流。
