# Windows Terminal Agent P0 可靠性加固设计

## 目标与边界

本设计只加固既有 Windows Terminal Agent 的本地运行可靠性。目标是在不改变打印业务语义的前提下，消除已证实的 UTF-8 BOM 配置解析退出，并让安装、配置写入、服务故障和现场诊断都有可验证的安全行为。

本设计不新增 Kiosk 入口、支付逻辑、打印任务逻辑、后台自动升级或远程命令执行。现有“一次性绑定码 → DPAPI token → Admin 设备管理”的闭环保持不变。

## 已有能力

- `apps/terminal-agent/src/index.ts` 以 `agent` 子命令启动单实例锁、SQLite、配置、注册/凭据加载、心跳、领取循环和离线补偿。
- `node-windows` 已将该命令安装为 `AIJobPrintAgent` 服务；现有安装脚本设置其为 Automatic 并在安装后回读云端心跳。
- `install-production-agent.ps1` 校验打印机、将 token 用 DPAPI LocalMachine 加密写入 `%ProgramData%\AIJobPrintAgent\agent.token`，并支持后台生成的一次性绑定码。
- Admin 设备管理已生成一次性绑定码、记录 MAC/设备指纹、启停终端、绑定机构并写入审计。

## 已证实缺口

1. `loadConfig()` 直接对 UTF-8 文本调用 `JSON.parse`；有效 JSON 若带 BOM 会在启动阶段退出。
2. 配置写入不是原子替换，写入中断可能留下半文件；现有备份只在安装脚本中发生，运行时注册写入没有最近有效副本。
3. 现有服务开机自动启动，但没有由安装脚本明确配置 Windows SCM 的失败恢复策略；不能把 node-windows 包装器的短期重启等同于长期可维护的恢复策略。
4. 配置致命错误只存在本地日志；后台只能间接看到心跳陈旧，现场缺少统一的脱敏诊断入口。

## 设计原则

### 1. 打印安全优先于“永远运行”

无效、缺字段或身份不一致的配置不得静默改用未知终端、未知 API 或旧 token。配置错误属于不可自动修复故障：服务可按受控次数尝试恢复，但最终必须停在安全状态并留下明确诊断，绝不领取或打印任务。

网络短暂失败、服务进程意外崩溃属于可自动恢复故障：Windows SCM 负责有限次数、递增间隔的重新启动；Agent 重启后仍依靠既有 SQLite 保证不重复出纸。

### 2. 凭据与绑定不改写

`agent.token` 继续是 DPAPI LocalMachine 加密文件；配置文件绝不写入 `agentToken`、`adminSecret` 或一次性绑定码。P0 不修改绑定码 API、token 轮换、MAC 唯一性或 Admin 终端表结构。

### 3. 诊断可见但不泄密

诊断只能显示状态码、时间、文件路径、字段名、服务状态和脱敏错误类别。不得输出 token、绑定码、`Authorization`、完整配置或用户文件路径。

## P0 组件设计

### A. 配置韧性：`config-manager.ts`

读取步骤固定为：

1. 读取 UTF-8 文本，仅移除开头的 `U+FEFF`；中间字符不改变。
2. 解析 JSON，移除示例 `_comment`，验证必填字段和字段类型。
3. 只有验证成功后，才允许旧明文 token 迁移、加载 DPAPI token 或开始任何网络/打印循环。
4. 解析、验证或 token 解密失败时，抛出分类错误（例如 `AGENT_CONFIG_INVALID`、`AGENT_CONFIG_REQUIRED_FIELD_MISSING`、`AGENT_TOKEN_DECRYPT_FAILED`），由入口记录脱敏诊断后退出。

所有 Agent 自己触发的配置写入必须：先在内存中序列化、再次解析并验证；写至同目录临时文件；刷新文件句柄；以原子 rename 替换正式文件。替换前仅在现有正式配置能通过相同验证时，更新一个不含凭据的最近有效副本。临时写入失败时，原正式配置不得变化。

最近有效副本只用于人工维护的“恢复候选”与诊断，不在 Agent 启动时静默覆盖人工修改后的主配置。这样避免错误地回到旧终端身份并领取其他机器的任务。

### B. 服务韧性：既有安装脚本与 Windows SCM

`install-production-agent.ps1` 保留现有打印机、绑定码、DPAPI、服务安装和心跳验证步骤，并新增：

- 设置服务为 Automatic；
- 显式配置 SCM failure actions：第一次失败延迟重启，第二次失败使用更长延迟，第三次失败不再自动重启；每日重置失败计数；
- 写入/显示实际服务恢复策略，安装脚本的验证结果不得只以 `Get-Service Running` 代替；
- 安装或升级前运行配置预检；预检失败不重启服务、不兑换绑定码、不修改 token；
- 禁止脚本通过测试打印来判断安装成功。

三次失败后不再重启是刻意的：配置错误或损坏依赖不能靠无限重启解决。后台会看到心跳陈旧，现场人员用本地诊断定位后再执行受控修复。

### C. 脱敏诊断与后台可见性

新增一个不发网络写请求、不领取任务、不打印的本地诊断命令/PowerShell 模式。它输出：

- 服务是否存在、启动类型、运行状态、PID 与父进程；
- 配置是否存在、是否含 BOM、是否能解析、必填字段是否存在（仅 true/false）；
- DPAPI token 文件是否存在，不读取或输出其内容；
- 最近一条分类错误和日志时间；
- 现有云端心跳查询结果（online、printerStatus、lastSeenAt）。

Admin 不新增页面。P0 复用既有终端列表的在线、打印机、版本、最近心跳与启停状态；现场 runbook 规定“服务停止 + 最近心跳陈旧 + 诊断错误分类”是需维护状态。

## 状态与故障决策

| 情形 | Agent 行为 | 打印任务 | 运维动作 |
| --- | --- | --- | --- |
| 有 BOM 的有效 JSON | 去 BOM 后正常启动 | 按既有规则 | 无需人工处理 |
| JSON 损坏/缺必填字段 | 分类报错，受控退出 | 不领取、不打印 | 诊断并人工恢复有效配置 |
| token 不能解密 | 分类报错，受控退出 | 不领取、不打印 | Admin 生成新绑定码后重绑 |
| 短暂网络失败 | 保持运行、既有重试继续 | 既有离线规则 | 后台观察心跳恢复 |
| 进程异常退出 | SCM 按有限策略重启 | SQLite 防重印继续生效 | 多次失败后进入需维护状态 |
| 打印机离线/错误 | 既有 preflight 与状态回传 | 不盲目出纸 | 维护打印机，不重绑终端 |

## 文件边界

预期修改：

- `apps/terminal-agent/src/agent/config-manager.ts`：BOM、验证、原子写入、有效副本与分类错误。
- `apps/terminal-agent/src/index.ts`：启动错误分类与本地诊断命令注册；不改变领取/打印实现。
- `apps/terminal-agent/scripts/install-production-agent.ps1`：预检、SCM failure actions、无打印验证。
- `apps/terminal-agent/package.json`：新增 verify 命令入口。
- `apps/terminal-agent/scripts/verify-agent-config-resilience.mjs`：配置韧性静态/行为验证。
- `apps/terminal-agent/scripts/verify-windows-service-recovery.mjs`：服务恢复配置脚本契约验证。
- `docs/device/production-agent-onboarding.md`：安装、诊断与恢复口径。

不修改：Kiosk、支付、`task-runner.ts` 的领取/打印逻辑、绑定码后端/前端、Prisma schema、生产数据库。

## 验收标准

### 本地源码与 CI

- BOM 配置、无 BOM 配置、损坏 JSON、缺字段、DPAPI 文件缺失/解密失败分别有确定的无敏感输出结果。
- 任意 Agent 自己写入配置后，主配置始终是可解析 JSON；中断模拟不破坏原主配置。
- verify 明确证明安装脚本配置了有限 SCM 重启，而非无限循环。
- 既有 `verify:print-scan-agent`、`verify:printer-config`、类型检查继续通过。

### Windows 受控验收（不打印）

1. 使用不含真实任务的测试终端或当前终端的空队列窗口；确认 `active_task_count=0`。
2. 准备有效 BOM 配置，启动服务，确认一次心跳与 `printerStatus` 回传；不创建任务。
3. 验证诊断命令不输出 token、绑定码或完整配置。
4. 查询 `sc qfailure`/等效系统输出，确认三档失败策略与重置周期。
5. 使用可逆方式模拟一次 Agent 非业务退出，确认按策略恢复且没有打印任务。
6. 最终再次确认队列仍为空、服务 Running、后台心跳更新。

这些证据只证明 Agent 可靠性 P0，不等同于新 MSI、自动升级、真实出纸或完整商用验收。

## 后续阶段（不纳入 P0）

- P1：Windows 构建机产出可修复/可卸载的签名 MSI，保留 `%ProgramData%` 状态并验证升级回滚。
- P2：后台受控发布版本、签名包校验、分批升级和健康失败回滚。
