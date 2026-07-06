# 生产 Windows Terminal Agent 授权与加固方案

> 目标：商用环境中云端是唯一打印任务源，Windows 主机只作为硬件执行器，避免本地 API 与远程 API 互相“打架”。

## 当前推荐流程

短期可落地方式：使用 `apps/terminal-agent/scripts/install-production-agent.ps1` 在 Windows 主机上固化生产配置。

脚本负责：

- 固定 `apiBaseUrl` 为生产云端 `/api/v1`；
- 固定 `terminalCode` / `terminalId`；
- 校验 Windows 打印机名；
- 使用 Windows DPAPI LocalMachine 加密保存 `agentToken`；
- 安装/启动 `AIJobPrintAgent` Windows 服务，并设置开机自启；
- 校验远程心跳在线。

示例：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\install-production-agent.ps1 `
  -ApiBaseUrl "https://api.example.com/api/v1" `
  -TerminalCode "KSK-001" `
  -TerminalId "t_ksk_001" `
  -AgentToken "<terminal-token>" `
  -PrinterName "Pantum CM2800ADN Series"
```

使用后台一次性绑定码（推荐商用流程）：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\install-production-agent.ps1 `
  -ApiBaseUrl "https://api.example.com/api/v1" `
  -TerminalCode "KSK-001" `
  -TerminalId "t_ksk_001" `
  -BindCode "<一次性绑定码>" `
  -PrinterName "Pantum CM2800ADN Series"
```

如果 token 已经保存在 `%ProgramData%\AIJobPrintAgent\agent.token`：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\install-production-agent.ps1 `
  -ApiBaseUrl "https://api.example.com/api/v1" `
  -TerminalCode "KSK-001" `
  -TerminalId "t_ksk_001" `
  -PrinterName "Pantum CM2800ADN Series" `
  -UseExistingToken
```

## 商用正式方案：后台绑定码

管理员后台已提供“终端授权/重绑”能力：

1. 管理员在后台创建或选择终端；
2. 后台生成 20 位一次性绑定码，默认 10 分钟过期，最长 60 分钟；
3. Windows 主机安装脚本输入绑定码；
4. Agent 用绑定码换取 `terminalId` + `agentToken`；
5. 绑定码立即失效；
6. Agent 写入生产配置，DPAPI 加密保存 token，安装并启动服务。

当前后端 API 已接入该闭环：

```text
POST /api/v1/admin/terminals/:terminalId/bind-code
  管理员生成一次性绑定码，明文只返回一次。

POST /api/v1/auth/terminal/exchange-bind-code
  Windows Agent 安装脚本用绑定码换取 terminalId + terminalToken。
```

安全要求：

- Windows 主机不得保存 `TERMINAL_ADMIN_SECRET`；
- 绑定码只能使用一次，且短时有效；
- 同一终端重新生成绑定码时，旧的未使用 / 未过期绑定码会被撤销；
- 重新绑定同一 `terminalCode` 时旧 token 必须立即失效；
- 生成绑定码、兑换绑定码、重绑必须写审计日志；解绑如后续实现，也必须写审计日志；
- 绑定时记录主机名、MAC、设备指纹、Agent 版本、打印机名；
- 本地调试配置必须与生产配置分离，不允许同一时间两个 Agent 监听同一打印机。

## 环境原则

商用默认：

```text
Kiosk 前端 → 云端 API
Windows Agent → 云端 API
云端数据库 → 唯一任务真相源
Windows 主机 → 只执行打印/扫描/外设交互
```

本地 API 只用于开发调试、工厂测试或离线诊断，不作为商用订单/打印任务来源。

Terminal Agent 运行时已有互斥保护：`agent` 启动时如果发现 `apiBaseUrl` 指向 `localhost` / `127.0.0.1` / `::1` / `0.0.0.0`，默认拒绝启动。只有明确设置以下环境变量时，才允许连接本地 API：

```powershell
$env:AGENT_PROFILE = "local-debug"
node dist/index.js agent
```

该开关只用于开发或现场隔离诊断。商用 Windows 服务不得设置 `AGENT_PROFILE=local-debug`。
