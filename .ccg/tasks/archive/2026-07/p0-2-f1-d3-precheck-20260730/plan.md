# P0-2 / F1 D3 执行计划

1. 复核 PR #436 合并提交、`origin/main` 精确 SHA、GitHub CI 与工作树隔离状态。
2. Claude、antigravity、Cursor 分别从 provenance、安全边界、执行完整性角度审查 D3 检查表；合并去重后锁定只读命令白名单与停止条件。生产 PM2 只允许输出 name/status/cwd/script/args 白名单字段，禁止 `pm2 env`、全量 describe/jlist 输出、日志和环境值。
3. 本地执行 frozen install 与 F1 离线门禁，核验 candidate source、Genesis/activation 实现和构建产物可再生性；只计算 launcher/guard 等候选产物摘要，不创建生产 release。明确记录当前 activate CLI 的 runtime-env contract 参数，并登记旧 runbook 示例漂移。
4. 只有正式资料能唯一确定 managed 主机、端点、PM2 名称、current/control/artifact/launcher/contract 路径及预期摘要时，才对生产执行批准的字段过滤只读预检；先核验 `127.0.0.1:3010` 独占与 legacy/managed 隔离拓扑，再检查 control root 保留、零流量、权限分离和锁恢复 SOP。不运行任何生成、激活、reload、restart 或切流命令。
5. 将逐项证据和 GO / NO-GO 写入审查文档，同步正式进度入口。
6. 由 Claude + antigravity 对结果和 diff 双审；运行文档、diff、敏感信息与范围验证后归档 CCG 任务。

## 硬停止条件

- 远端身份或目标主机无法从现有正式配置确定。
- 具名审批附件未固定 managed 主机、PM2 名称、批准路径与预期 SHA-256；此时禁止用 legacy 主机或猜测路径代替。
- 任一命令可能写文件、改变进程、访问秘密值或读取业务数据。
- managed 平面事实与审批标识不一致，或存在未知 lock/control state。
- legacy 与 managed 无法同时满足独立主机或等价隔离、并各自独占固定 `127.0.0.1:3010`。
- control root 长期保留边界或残留锁人工恢复 SOP 无法证明。
- 需要 D4–D6 权限才能继续。
