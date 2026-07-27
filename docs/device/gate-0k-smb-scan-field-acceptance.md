# Gate 0k — SMB 面板扫描现场验收包

> 最后更新：2026-07-27  
> 授权包名建议：`GATE_0K_SMB_SCAN`  
> 终端：`t_ksk_001` / `KSK-001`  
> 前置：Kiosk B1 诚实化已预发（[PR #413](https://github.com/wanglei581/YITIJI/pull/413)，bundle `index-DeG21wry.js`）  
> 范围：**仅** SMB/面板扫描 → Agent `scanWatchFolder` → deliver → COS/「我的文档」  
> **不在本包**：U 盘 bridge token、TWAIN 一点即扫（Spike C）、收费支付、F1 Genesis

关联：

- 总清单：`docs/device/production-deployment-and-windows-host-checklist.md` §5.7
- 打印现场旁证样板：`docs/device/windows-field-recheck-phase-f-runbook.md`
- B1 规格：`docs/superpowers/specs/2026-07-27-kiosk-scan-ux-honesty-design.md`

---

## 边界

| 阶段 | 谁做 | 内容 |
|------|------|------|
| **Phase R（远程）** | 可 SSH 预发 API | lifecycle / 空队列 / health / 心跳 / capability 模式 |
| **Phase W（现场 Windows）** | **必须人在一体机旁** | SMB 共享、Agent `scanWatchFolder`、服务日志、面板扫描 E2E |

禁止：

- 未授权造单「只为验收」以外的业务写入；本包允许 **1 次**真实面板扫描建会话（用户点名后）。
- 把 `agent.token` / BindCode / bridge token / UNC 含账号密码贴进聊天或仓库。
- 把 Mac `verify:scan-watcher` 写成真机扫描已通过。
- 在未配置 `scanWatchFolder` 时宣称扫描闭环。

---

## Phase R — 远程旁证（2026-07-27 复检）

在预发 API 主机只读确认（**不替代 Phase W**）：

| 检查 | 结果 |
|------|------|
| `GET /api/v1/health` | `ok` / `db=postgres` |
| `Terminal` `t_ksk_001` / `KSK-001` | `enabled=true`，`lifecycleStatus=active`，`lifecycleVersion=10`，`credentialGeneration=8` |
| active `PrintTask` (`pending/claimed/printing`) | **0** |
| active `ScanTask` (`waiting/matched`) | **0** |
| `TerminalCapability` 行数 | **0**（`PRINT_SCAN_CAPABILITY_MODE=managed` 下空表仍允许建扫描会话；**不**证明硬件已验） |
| 最近 `TerminalHeartbeat` | `status=online`，`printerStatus=ready`，`agentVersion=0.3.0-production`，`localTaskDatabaseAvailable=true`（近实时） |
| 公网 Kiosk | `https://zyidai.cn/` → `index-DeG21wry.js`；扫描文案含「可创建扫描任务 · 需面板操作」，无「扫描仪就绪」 |

结论：云端侧 **已允许**建扫描会话；**现场仍须**配置 `scanWatchFolder` + 奔图面板扫到接收目录 + Agent deliver。

---

## Phase W — 现场步骤（一体机 Windows）

用 **管理员 PowerShell**。证据放到仓库外目录，例如：

```powershell
$EvidenceRoot = Join-Path $env:TEMP ("ai-job-print-evidence\gate0k-smb-" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
Write-Host $EvidenceRoot
```

### W1. Agent 服务与配置路径

```powershell
Get-Service AIJobPrintAgent | Format-List Name, Status, StartType |
  Tee-Object (Join-Path $EvidenceRoot "W1-service.txt")
```

配置文件按安装方式二选一（**勿**把 token 贴出）：

| 安装方式 | 配置路径 |
|----------|----------|
| 正式 Windows 服务 | `%ProgramData%\AIJobPrintAgent\agent-config.json` |
| 仓库目录跑服务 | `<repo>\apps\terminal-agent\config\agent-config.json` |

确认已有字段：`apiBaseUrl`、`printerName`（等于 Windows 打印机名）、身份对应 `KSK-001` / `t_ksk_001`。

### W2. 准备接收目录 + 写 `scanWatchFolder`

推荐本机路径（示例，可改）：

```text
C:\AIJobPrint\scan-inbox
```

```powershell
New-Item -ItemType Directory -Force -Path 'C:\AIJobPrint\scan-inbox' | Out-Null
# 确认服务账户（通常 LocalSystem）对该目录有读写权限
icacls 'C:\AIJobPrint\scan-inbox'
```

在 Agent 配置中增加（或修改）**唯一**键名：

```json
"scanWatchFolder": "C:\\AIJobPrint\\scan-inbox"
```

注意：

- 代码键名是 **`scanWatchFolder`**，不是设计文档旧名 `smbScanDir`。
- 路径必须是 Agent 进程能直接读到的本地路径或已映射路径；打印机面板「扫描到网络/SMB」的目标必须落到**同一目录**。
- 不要把含明文账号密码的 UNC 写进聊天；现场只记「已配置本地路径 / 已配置 UNC（脱敏）」。

保存配置后重启服务：

```powershell
Restart-Service AIJobPrintAgent
Start-Sleep -Seconds 5
Get-Service AIJobPrintAgent | Format-List Status
```

### W3. 确认 watcher 已启动

查看 Agent 日志（路径以现场为准：ProgramData 日志或服务 stdout）：

期望出现：

```text
scan-watcher: watching C:\AIJobPrint\scan-inbox
```

若出现：

```text
scan-watcher: scanWatchFolder 未配置，跳过扫描监听
```

→ **STOP**：配置未生效，勿继续面板扫描。

把脱敏日志片段存到 `$EvidenceRoot\W3-watcher.log`。

### W4. 打印机面板指向同一目录

在奔图操作面板：

1. 扫描 → 扫描到网络 / SMB（或现场已配好的网络文件夹）
2. 目标 = 上一步 Agent 正在 watch 的目录
3. 建议：简历黑白；证件 300 DPI；输出 **PDF**（Agent 也接受 jpg/png）

### W5. Kiosk E2E（点名授权后执行 1 次）

1. 一体机浏览器打开 `https://zyidai.cn/scan`（或现场全屏 Kiosk）
2. 选类型（建议先 `document`）→ 创建会话
3. 屏幕应显示服务端 `instructions`（含「扫描到网络 / SMB（本机已配置的接收目录）」）
4. 在打印机面板按「开始」扫描
5. 回到一体机等待自动识别；**勿关闭页面**
6. 期望：会话匹配 → 完成 → 可「前往我的文档 / 登录后管理文件」

旁证（远程或 Admin，脱敏）：

- `ScanTask`：`waiting → matched → completed`（或等价终态）
- 有 `FileObject` / COS 对象；不在聊天贴签名 URL 全文

失败时常见原因：

| 现象 | 排查 |
|------|------|
| 建会话失败 `SCAN_TERMINAL_NOT_ACTIVE` | 远程再确认 lifecycle=`active` |
| 一直 waiting | watcher 未启动 / 面板扫到别的目录 / 文件扩展名非 pdf/jpg/png |
| deliver 失败 | 看 Agent 日志；文件可能留在目录或进 `_unclaimed` |
| 页面超时 | 会话过期；重新建会话，勿多开会话（同终端同时只能 1 个 waiting/matched） |

### W6. 通过标准（全部勾上才可写「Gate 0k SMB 扫描现场通过」）

- [~] Agent 日志有 `scan-watcher: watching …`（**未入仓原文**；由下方 completed deliver 旁证 watcher 已工作）
- [x] 面板扫描文件出现在 watch 目录后被 Agent 消费（源文件删除或等价成功路径）— 预发库 `ScanTask.completed` + `FileObject` PDF
- [x] `ScanTask` 到达成功终态 — 代表 `cms31h42w002yyga8di19zmdi`（及同日多笔）
- [~] 文件可在会员「我的文档」或登录后管理入口看到（按账号策略）— 交付当时有 `FileObject`；部分 `resume_scan` 随后 `deleted`（短保留）
- [x] Kiosk 未出现「扫描仪就绪」等假硬件态（B1 #413 已预发）
- [x] 证据：任务 id / fileId / purpose / mime 已写入 `docs/progress/current-progress.md`（无 token、无路径明文）

**2026-07-27 判定**：Gate 0k SMB **交付闭环旁证成立**（预发库）；不等于 U 盘导入、TWAIN 或全量 Windows 主机清单全部勾完。

### W7. 验收后可选（另授）

- Admin 将 `TerminalCapability.scan` 设为 `available` 并写备注「Gate 0k SMB 现场交付旁证 + 日期」——仅在 W6 旁证成立之后。
- U 盘：另授注入 `VITE_TERMINAL_AGENT_BRIDGE_TOKEN` 与 Agent `localApiBridgeToken` 一致后的 Kiosk-only 热更。
- Spike C（TWAIN）：另开，不在本包。

---

## 回执（预发库旁证，2026-07-27）

```text
GATE_0K_SMB_SCAN 回执
日期：2026-07-27
终端：KSK-001 / t_ksk_001
W1 服务 Status/StartType：（现场未贴回；心跳曾 online）
W2 scanWatchFolder 已配置：是（推断；路径未入仓）
W3 watching 日志：未入仓；由 completed deliver 旁证
W5 ScanTaskId：cms31h42w002yyga8di19zmdi（代表）；另见同日多笔 completed
W5 终态：completed + FileObject application/pdf
W6 旁证：成立（交付闭环；日志原文/我的文档长留未全证）
阻塞（如有）：U 盘 bridge token；Spike C
```
