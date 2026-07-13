# 打印扫描首期安全底座现场验收证据包

> PENDING REAL-EVIDENCE
> G0 STATIC GUARD READY：2026-07-01
> 本文件只记录脱敏摘要、证据 ID、候选 commit 和结论；原始截图、录屏、命令日志、SQL 输出、真机照片、打印实物照片和 Windows 现场日志必须保存在仓库外私有证据目录。
> 本文件不代表生产迁移已执行、Windows 真机完整验收已通过、真实扫描已完成、U 盘导入已完成、奔图彩色 mode 已确认或小范围试运营已完成。
> 执行步骤见：[打印扫描 PS-G1~PS-G4 执行清单](./print-scan-field-execution-runbook.md)。

## 目标

验证打印扫描首期安全底座在现场环境中满足以下最低条件：

- 打印任务创建必须绑定目标 `terminalId`。
- Terminal Agent 只能领取自身 `terminalId` 的 pending 打印任务。
- Agent 本地任务库不可用时必须 fail-closed，并上报 `agent_degraded` 与 `localTaskDatabaseAvailable=false`。
- Admin 能看到降级状态和运维提示。
- 后端二道闸门在最新心跳明确降级时不下发新任务，任务保持 `pending`。
- Agent 恢复后，同一终端可以继续领取被保护的任务。

## 非目标

- 不在本证据包中实现真实扫描、U 盘导入、证件照、格式转换、云上传或签名盖章。
- 不把本地 verify 通过写成生产验收或真机验收通过。
- 不记录真实手机号、验证码、cookie、JWT、签名 URL、简历正文、数据库连接串、Redis 连接串、COS 密钥、短信密钥、LLM/OCR 密钥、终端公网 IP、MAC 地址或设备序列号。
- 不把 Pantum 彩色打印参数写死为未经厂家确认的 mode 值。

## 证据保存规则

| 资产类型 | 仓库内允许记录 | 必须仓库外保存 | 脱敏要求 |
| --- | --- | --- | --- |
| 候选代码 | commit、构建命令、verify PASS 摘要 | 完整命令日志 | 日志进入共享证据前必须移除绝对密钥路径和本机用户名 |
| 生产 / 预生产配置 | 变量名和 `configured/not configured` 摘要 | `.env`、PM2 env、数据库连接串 | 禁止记录任何真实值 |
| Windows 终端 | 逻辑编号、Agent 版本、脱敏 terminalId | IP、MAC、序列号、现场照片 | 物理标识必须遮挡 |
| 打印任务 | 任务状态链路、错误码、脱敏任务 ID 前缀 | DB 查询原文、签名 URL、真实文件 | 文件 ID 和 taskId 只保留前 8 位或 hash 摘要 |
| 出纸证据 | 是否出纸、纸张类型、黑白 / 彩色配置摘要 | 出纸照片、现场录屏 | 简历内容、姓名、电话、头像和现场人员必须遮挡 |
| 降级演练 | `agent_degraded`、`localTaskDatabaseAvailable=false`、Admin 文案摘要 | Agent 原始日志、Windows 事件日志 | 日志不得包含 token、路径中的真实用户名或文件内容 |

## Gate 0：本地静态门禁

| 证据 ID | 状态 | 通过标准 | 脱敏摘要 |
| --- | --- | --- | --- |
| PS-G0-01 | Passed Locally | `pnpm --filter @ai-job-print/api verify:print-scan-first-release` 通过 | 代码不变量和本文档结构门禁通过后填写候选 commit |
| PS-G0-02 | Passed Locally | `pnpm --filter @ai-job-print/api verify:print-jobs` 覆盖降级不可领取、恢复后可领取 | 不记录真实文件 URL 或签名参数 |
| PS-G0-03 | Passed Locally | CI 串行 Verify suites 包含 `verify:print-scan-first-release` | 只记录 workflow 名和步骤名 |
| PS-G0-04 | Passed Locally | `pnpm --filter terminal-agent verify:print-scan-agent` 覆盖本地任务库不可用 fail-closed | 不记录 Windows 本地路径 |

判定：

```text
Gate 0 Static Guard: Passed Locally
范围：只证明本地代码不变量、文档口径和 CI 接线，不代表现场验收完成。
```

## Gate 1：现场只读预检

| 证据 ID | 状态 | 通过标准 | 仓库外证据 |
| --- | --- | --- | --- |
| PS-G1-01 | Not Passed Yet | API health 返回 PostgreSQL / Redis 候选环境可用 | `<PRIVATE_EVIDENCE_DIR>/PS-G1-01-health-<timestamp>.log` |
| PS-G1-02 | Not Passed Yet | 目标终端心跳在线，Admin 显示正确逻辑编号 | `<PRIVATE_EVIDENCE_DIR>/PS-G1-02-terminal-heartbeat-<timestamp>.png` |
| PS-G1-03 | Not Passed Yet | Windows 版本、Kiosk 浏览器、屏幕分辨率、Agent 版本完成脱敏记录 | `<PRIVATE_EVIDENCE_DIR>/PS-G1-03-windows-agent-profile-<timestamp>.md` |
| PS-G1-04 | Not Passed Yet | Pantum Windows 驱动识别名确认，且代码不硬编码型号 | `<PRIVATE_EVIDENCE_DIR>/PS-G1-04-printer-driver-<timestamp>.png` |

判定：

```text
Gate 1 Field Preflight: Not Passed Yet
阻塞项：尚未执行 Windows 一体机、Pantum 真机和预生产 / 生产候选环境只读预检。
```

## Gate 2：生产迁移与候选部署

| 证据 ID | 状态 | 通过标准 | 仓库外证据 |
| --- | --- | --- | --- |
| PS-G2-01 | Not Passed Yet | PostgreSQL 备份完成，备份可读取目录 | `<PRIVATE_EVIDENCE_DIR>/PS-G2-01-db-backup-<timestamp>.log` |
| PS-G2-02 | Not Passed Yet | 本次 `TerminalHeartbeat` additive migration 在目标环境执行成功 | `<PRIVATE_EVIDENCE_DIR>/PS-G2-02-migrate-deploy-<timestamp>.log` |
| PS-G2-03 | Not Passed Yet | 目标运行时 commit / dist hash / PM2 进程脱敏记录完成 | `<PRIVATE_EVIDENCE_DIR>/PS-G2-03-runtime-hash-<timestamp>.md` |
| PS-G2-04 | Not Passed Yet | Admin、Kiosk、API health 候选入口可达 | `<PRIVATE_EVIDENCE_DIR>/PS-G2-04-runtime-health-<timestamp>.log` |

判定：

```text
Gate 2 Deployment And Migration: Not Passed Yet
阻塞项：尚未在生产 / 预生产候选环境执行本次 migration 和候选运行时复验。
```

## Gate 3：现场打印安全底座

| 证据 ID | 状态 | 通过标准 | 仓库外证据 |
| --- | --- | --- | --- |
| PS-G3-BIND-01 | Not Passed Yet | 终端 A 创建的 PrintTask 只被终端 A claim，终端 B 不领取 | `<PRIVATE_EVIDENCE_DIR>/PS-G3-BIND-01-terminal-isolation-<timestamp>.log` |
| PS-G3-STATUS-01 | Passed (Business Print Sample) | 任务状态链路覆盖 `pending -> claimed -> printing -> completed` 或明确 `failed` | 2026-07-08 生产业务打印样本 `ptask_kiosk_1568da9b5971c10f` 记录 `pending -> claimed -> printing -> completed`；Agent 日志摘要含 claim、download、SHA-256 校验、PATCH printing、`Pantum CM2800ADN Series` 打印、PATCH completed；完整日志在仓库外 Windows 证据中 |
| PS-G3-PAPER-01 | Passed (Conditional) | 真实纸张输出需由现场目视、摄像头、打印机计数器或设备日志至少一种证明 | 仓库外证据包 `<PRIVATE_EVIDENCE_DIR>/physical-print-20260706101346/evidence-summary.md` 记录打印机计数器 27→28、28→29，且 PrintService Event ID 307 / 842 可关联 `Pantum CM2800ADN Series` / `USB001`；如现场实际未看到纸张，应立即改判 failed |
| PS-G3-DEG-01 | Not Passed Yet | 模拟本地任务库不可用后，心跳为 `agent_degraded` 且 `localTaskDatabaseAvailable=false` | `<PRIVATE_EVIDENCE_DIR>/PS-G3-DEG-01-agent-degraded-<timestamp>.png` |
| PS-G3-DEG-02 | Not Passed Yet | Agent 降级期间后端 claim 返回空任务，目标任务保持 `pending` | `<PRIVATE_EVIDENCE_DIR>/PS-G3-DEG-02-claim-empty-pending-<timestamp>.log` |
| PS-G3-REC-01 | Not Passed Yet | 恢复本地任务库后，Agent 上报 online 并可继续领取同一终端任务 | `<PRIVATE_EVIDENCE_DIR>/PS-G3-REC-01-recovery-claim-<timestamp>.log` |
| PS-G3-NEG-01 | Not Passed Yet | 错终端状态回传被拒，命中 `TASK_NOT_OWNED` 或等效错误 | `<PRIVATE_EVIDENCE_DIR>/PS-G3-NEG-01-wrong-terminal-rejected-<timestamp>.log` |

判定：

```text
Gate 3 Field Print Safety Base: Partial Passed
已通过：物理出纸最小硬证据、生产业务打印状态链路 completed。
阻塞项：终端隔离、Agent 降级 / 恢复、错终端回传拒绝等完整安全底座现场演练仍未全部完成。
门禁含义：Partial Passed 仍是阻塞态，不满足进入试运营或宣称完整 Gate 3 通过的条件。
```

## 追加证据：2026-07-08 生产微信支付 / 退款回调 / 打印恢复

本节只记录脱敏摘要。完整微信交易号、微信退款单号、生产 API 日志、Windows Agent 日志、PrintService 事件和截图保存在仓库外受控证据目录；不得把 token、证书、签名 URL、cookie、真实文件内容或完整支付流水日志提交进 Git。

| 证据 ID | 状态 | 通过标准 | 脱敏摘要 |
| --- | --- | --- | --- |
| PS-PAY-20260708-01 | Passed | 真实微信支付单入账，订单为 `paid` 且 `paymentSource=wechat` | 订单 `ORD-20260708-3143F78E78`，金额 100 分，`PaymentAttempt.status=success`，内部 `Order.id` 与微信交易号仅保存在私有证据 |
| PS-REFUND-20260708-01 | Passed | Admin 发起退款后，微信退款回调命中生产端点并完成验签 / 解密 / 幂等状态机 | `RFD-ORD-20260708-3143F78E78`，`Refund.status=success`，`Order.payStatus=refunded`，`refundedAmountCents=100`，`STUCK_REFUNDING=0`；约 62 秒内由微信异步回调收敛，无需主动查证 / cron |
| PS-PRINT-RECOVERY-20260708-01 | Passed | Windows 打印队列从 `Error, Printing, Retained` 恢复，后续业务打印任务 completed | Print Spooler Running / Automatic；`AIJobPrintAgent` Windows 服务 Running / Automatic；`Pantum CM2800ADN Series` `printerStatus=ready` / `isOnline=true`；最终队列为空 |
| PS-PRINT-20260708-01 | Passed | 新业务打印任务完成 `pending -> claimed -> printing -> completed` | 订单 `ORD-20260708-9863A8A101`，任务 `ptask_kiosk_1568da9b5971c10f`；Agent 日志摘要：download 1.5 KB、SHA-256 校验通过、print success 786ms、PATCH completed；Windows PrintService Event ID 307 / 842 / Win32 `0x0` |

结论：

```text
2026-07-08 Production Paid Print And Refund Callback: Passed
已证明：真实微信支付、Admin 退款、微信退款回调、订单退款状态、对账无卡退款、Windows 队列恢复和一笔业务打印 completed。
未证明：真实扫描、U 盘导入、断网 / 断电恢复、Agent 降级 / 恢复全套演练、小范围试运营授权。
```

## Gate 4：隐私删除与异常恢复

| 证据 ID | 状态 | 通过标准 | 仓库外证据 |
| --- | --- | --- | --- |
| PS-G4-01 | Not Passed Yet | 打印完成或失败后，本地临时文件按 TTL 清理，无法继续打开用户文件 | `<PRIVATE_EVIDENCE_DIR>/PS-G4-01-local-cache-cleanup-<timestamp>.log` |
| PS-G4-02 | Not Passed Yet | 卡住任务释放后仍保留目标 `terminalId`，不会被其它终端领取 | `<PRIVATE_EVIDENCE_DIR>/PS-G4-02-stuck-task-release-<timestamp>.log` |
| PS-G4-03 | Not Passed Yet | 断网 / 断电恢复不会把未出纸任务标记为 completed | `<PRIVATE_EVIDENCE_DIR>/PS-G4-03-offline-recovery-<timestamp>.md` |
| PS-G4-04 | Not Passed Yet | Admin 可见失败原因、降级状态、恢复状态和人工处理记录 | `<PRIVATE_EVIDENCE_DIR>/PS-G4-04-admin-ops-visibility-<timestamp>.png` |
| PS-G4-05 | Not Passed Yet | Admin 审计抽样：对验收期间的文件访问、能力开关变更（terminal.capability.update）、任务重试/取消（print_scan.task.*）各抽取至少 3 条 AuditLog，核对操作者、目标与时间与实际操作一致 | `<PRIVATE_EVIDENCE_DIR>/PS-G4-05-admin-audit-sampling-<timestamp>.md` |

判定：

```text
Gate 4 Privacy And Recovery: Not Passed Yet
阻塞项：尚未执行高敏文件 TTL 删除、卡住任务释放、断网 / 断电恢复、Admin 运维可见性和 Admin 审计抽样（PS-G4-05）现场验收。
```

## 停止条件

出现以下任一情况，必须停止验收，先回到修复 / 配置阶段：

- Agent claim 到非本 `terminalId` 的打印任务。
- 降级期间仍领取到新打印任务。
- 真机未出纸但任务状态被标记为 `completed`。
- 错终端可回传 `printing` 或 `completed`。
- 打印完成或失败后仍可从本地缓存打开用户文件。
- Admin 看不到 `agent_degraded` 或本地任务库不可用提示。
- 证据截图、日志或摘要出现手机号明文、验证码、cookie、JWT、签名 URL、简历正文、密钥、数据库连接串、Redis 连接串或 COS/LLM/OCR/SMS 凭证。
- 任何文档把真实扫描、U 盘导入、Windows 真机完整验收或试运营写成已完成。

## 最终判定

```text
打印扫描首期安全底座现场验收结论：Not Passed Yet
是否允许宣称打印扫描商用全闭环完成：否
是否允许宣称 Windows 真机完整验收通过：否
是否允许宣称真实扫描 / U 盘导入完成：否
是否允许进入小范围试运营：否

签字 / 确认人：
日期：
```
