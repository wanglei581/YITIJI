# WINDOWS_FIELD_RECHECK — 现场 Phase F 核对清单

> 最后更新：2026-07-25  
> 授权包名：`WINDOWS_FIELD_RECHECK`  
> 终端：`t_ksk_001` / `KSK-001`  
> API 预发：现场当时为 `7e59243c`；其后预发 pin `0924a09b`（以服务器 `DEPLOY_SOURCE.txt` 为准）
>
> **2026-07-25 状态**：Phase F **已通过**（含 F4：`ptask_kiosk_2a75352b81631efb` completed + 用户确认出纸）。

## 边界

| 阶段 | 谁做 | 内容 |
|------|------|------|
| **Phase R（远程）** | 可 SSH 预发 API 的人/AI | health、printer-status、心跳、active 任务计数 |
| **Phase F（现场）** | **必须人在一体机旁** | Agent 服务、驱动名、`printerName`、真机出纸、断网恢复、Kiosk 全屏 |

禁止：未授权造打印单「只为验收」；未授权 close-unpaid；把 Agent token / 桥接 token 贴进聊天或仓库。

关联总清单：`docs/device/production-deployment-and-windows-host-checklist.md` §五。

---

## Phase R — 远程旁证（2026-07-25 复检）

在预发 API 主机只读确认（**不替代 Phase F**）：

| 检查 | 结果 |
|------|------|
| `GET /api/v1/health` | `ok` / `db=postgres` |
| `GET /api/v1/terminals/t_ksk_001/printer-status` | `printerStatus=ready`，`isOnline=true`，`lastSeenAt` 近实时 |
| `Terminal` `t_ksk_001` | `enabled=true`，有 mac，`lastSeenAt` 近实时 |
| 近 30 分钟 `TerminalHeartbeat` | 有多条（Agent 在上报） |
| 该终端 active `pending/claimed/printing` | 0 |
| `TerminalCapability` 行数 | 0（`PRINT_SCAN_CAPABILITY_MODE=managed` 下空表可接受，**不**证明扫描/USB 已验） |

结论：云端侧认为终端在线且打印机 ready；**现场驱动、服务、出纸、断网仍须 Phase F**。

---

## Phase F — 现场步骤（一体机 Windows）

在一体机上用 **管理员 PowerShell** 执行；把结果记在下方「回执」里（可打码路径）。

### F1. Agent 服务

```powershell
Get-Service AIJobPrintAgent | Format-List Name, Status, StartType
# 期望：Status=Running，StartType=Automatic（或符合现场策略）
```

若服务名不同，用：

```powershell
Get-Service | Where-Object { $_.Name -match 'AIJob|PrintAgent|Terminal' }
```

### F2. 打印机驱动名（勿硬编码进仓库；只对照 Agent 配置）

```powershell
Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | Format-Table -AutoSize
```

打开 Agent 配置（**勿**把 `agent.token` / bridge token 贴出），按现场安装方式二选一：

| 安装方式 | 常见配置路径 |
|----------|----------------|
| 正式 Windows 服务安装 | `%ProgramData%\AIJobPrintAgent\config.json` |
| 从仓库目录跑服务（预发/开发一体机） | `apps/terminal-agent/config/agent-config.json`（相对仓库根） |

确认：

- `printerName` **等于** Windows「打印机名称」列（不是随便写型号字符串）
- API base URL 指向当前预发/生产
- `terminalId` / 注册身份对应 `t_ksk_001` 或现场实际终端

### F3. 本机桥接仅监听本机（若启用 local API）

```powershell
netstat -ano | findstr LISTENING | findstr ":9527"
# 若 localApiPort 不是 9527，换成实际端口
# 期望：只见 127.0.0.1，不要 0.0.0.0（按现场设计核对）
```

### F4. 真机出纸（受控 1 页）

前提：现场有人值守、纸仓有纸、队列为空。

1. 打开 Kiosk 预发/生产域名全屏页  
2. 走既有「上传/打印」路径打 **1 页无个人信息** 测试 PDF（FREE_MODE 下可为 0 元）  
3. 确认：任务 `pending → printing → completed`，纸张实际出来，Windows 打印队列空  
4. **不要**为验收故意造未支付 pending 单去练 close-unpaid  

若今日不便出纸：在回执写「F4 跳过：原因 ____」，Phase F 不得标完全通过。

### F5. 断网恢复（约 3 分钟）

1. 拔网线或断 Wi‑Fi（按现场接入方式）约 60–90 秒  
2. 观察 Admin/API：`isOnline` 应变差或 lastSeen 停更（允许短暂延迟）  
3. 恢复网络后等待心跳：`isOnline=true` / `printerStatus=ready` 恢复  
4. 回执记录断网时长与恢复是否自动（无需手动重启 Agent）

### F6. Kiosk 全屏（抽查）

- Edge/Chrome Kiosk 全屏无系统弹窗阻断主路径  
- 首页设备状态与「在线/就绪」不长期打架（允许首帧轮询「检查中」）

---

## 授权与回执模板

现场做完后回复（**不要**贴 token / 密钥）：

```text
授权 WINDOWS_FIELD_RECHECK Phase F 回执
环境：预生产 / 终端 t_ksk_001
F1 Agent 服务：Running / Automatic = 是|否（实际名：____）
F2 printerName 与 Windows 打印机名一致：是|否（打印机显示名可打码后 4 字）
F3 local API 仅 127.0.0.1：是|否|未启用
F4 真机出纸 1 页：通过|跳过（原因）
F5 断网恢复自动上线：通过|失败|未做
F6 Kiosk 全屏抽查：通过|问题简述
说明：未造未支付关单；未贴 Agent token
```

收到回执后：勾总清单 §五中**已举证**子项；**F4 未真机出纸则本包不得标「Phase F 全部完成」**，§5.6 保持打开。

---

## Phase F 回执记录（2026-07-25，预生产 / `t_ksk_001`）

| 项 | 结果 | 备注 |
|----|------|------|
| F1 | ✅ | 显示名 `AIJobPrintAgent`，进程 `aijobprintagent.exe`；Running + Automatic |
| F2 | ✅ | `printerName` = Windows 名 `Pantum CM2800ADN Series`（配置项对照，非代码硬编码） |
| F3 | ✅ | `127.0.0.1:9527` |
| F4 | ✅ 补做通过 | 首次因本机文件选择器跳过；**2026-07-25 22:37 补做**：简历打印 → 扫码上传 → `ptask_kiosk_e0fe379299af7c50`，`claimed→printing→completed`（约 18s，无 errorCode），订单 `paid`/`amountCents=0`；用户确认「有出纸」；事后 active=0、printer ready。**2026-07-26 12:07 再确认**：`ptask_kiosk_f9587c2439e1855a` `claimed→printing→completed`（约 37s，无 errorCode）；用户回「是」；active=0、printer ready |
| F5 | ✅ | WLAN 断 75s；恢复后无需重启 Agent；Kiosk 显示「打印机在线」 |
| F6 | ✅（有限） | 1080×1920 竖屏主路径无 JS/系统弹窗阻断；**未**覆盖 Windows Assigned Access 专用会话 |

补充：当前服务从**仓库目录**运行，配置实际为 `apps/terminal-agent/config/agent-config.json`（非 `%ProgramData%\AIJobPrintAgent\config.json`）。正式换机交付仍须按 ProgramData/DPAPI 安装口径验收。

**结论：Phase F 通过**（F1–F6；F6 为有限全屏抽查）。旁证含 `ptask_kiosk_2a75352b81631efb`；2026-07-26 再确认 `ptask_kiosk_f9587c2439e1855a`。  
未执行：G5 退款冒烟、close-unpaid Phase B、收费切换、生产配置修改。  
不得据此宣称整机商用全部验收完成（扫描/U盘整机、彩色/双面参数、Assigned Access 等仍可另开）。

---

## 当前状态

- Phase R：✅ 2026-07-25（见上表）  
- Phase F：✅ **通过**（含 F4 出纸：`ptask_kiosk_e0fe379299af7c50`；2026-07-26 再确认 `ptask_kiosk_f9587c2439e1855a`）  
- 与本包无关：G5 真实退款冒烟、F1 Genesis、close-unpaid Phase B、密钥再轮换  
