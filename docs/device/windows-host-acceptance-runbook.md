# Windows 一体机换机 / Terminal Agent 真机验收手册（操作版）

> 最后更新：2026-06-13（Claude，上线前 P0 准备物，未在真机执行）
> 性质：本文是「**到了真机怎么一步步做**」；「**验收哪些项 / 通过标准**」见
> [checklist §五](./production-deployment-and-windows-host-checklist.md)。
> 设计细节（接口契约、模块、状态机）见
> [windows-terminal-agent-design.md](./windows-terminal-agent-design.md)。
>
> 适用：新换一体机主机、Terminal Agent 重新安装、奔图打印机重新接入。
> ⚠️ 旧机器通过 ≠ 新机器通过。换机必须按本手册重跑，不得默认继承。

---

## 0. 现场前提

| 项 | 要求（来自设计文档 §8.1 / §8.7） |
|---|---|
| 操作系统 | Windows 10 x64 21H2+ 或 Windows 11 x64；时区 `Asia/Shanghai` |
| 打印机 | 奔图 CM2800ADN/CM2820ADN 系列驱动 V3.x+ 已装，USB 或有线网络连接 |
| 浏览器 | Edge/Chrome，可进全屏 Kiosk 模式 |
| .NET | Framework 4.8（Win10 预装，WIA 依赖） |
| 网络 | 有线（建议 DHCP 静态绑定）；防火墙放行 Agent 访问后端 API |
| Windows 更新 | 营业时段不强制重启 |

---

## 1. 记录打印机真实识别名（第一步，别跳过）

```powershell
# PowerShell：列出 Windows 实际识别到的打印机名
Get-Printer | Select-Object Name, DriverName, PortName
```

- 设计文档预期识别名：`Pantum CM2800ADN Series`。
- **以本机实际输出为准**记录下来，下一步写进 `config.json` 的 `printerName`。
- 红线（CLAUDE.md §3）：`printerName` 必须可配置，**禁止在代码里硬编码任何具体型号字符串**。

验证打印机可被命令行驱动（先打一张系统测试页确认驱动通路）：

```powershell
# 活动打印任务探测（设计文档 §5.1 同款命令）
Get-PrintJob -PrinterName "Pantum CM2800ADN Series"   # 改成上一步记录的真实名
```

---

## 2. 部署 Agent + 配置文件

Agent 打包为单文件可执行（目标机不要求预装 Node.js，设计文档 §8.1）。

**配置文件路径**：`%ProgramData%\AIJobPrintAgent\config.json`
（仅 Agent 服务账号 / 管理员可读写）

```json
{
  "apiBaseUrl": "https://api.example.com/api/v1",
  "terminalId": "",
  "printerName": "Pantum CM2800ADN Series",
  "heartbeatIntervalSec": 30,
  "taskPollIntervalSec": 5,
  "claimLeaseSec": 300,
  "tempDir": "%ProgramData%\\AIJobPrintAgent\\temp",
  "logLevel": "info",
  "scanMode": "twain",
  "smbScanDir": "\\\\192.168.1.10\\scan-drop",
  "namedPipeName": "\\\\.\\pipe\\AIJobPrintAgent",
  "localApiPort": 9527
}
```

要点：
- `apiBaseUrl` 指向**生产/预生产** API（与服务器部署同一套）。
- `terminalId` 首次注册后由后端返回再回填（见 §3）。
- `printerName` = §1 记录的真实名。
- `localApiPort` 9527 仅监听 `127.0.0.1`，**绝不 bind 0.0.0.0**（设计文档 §4.3/§7.2）。

---

## 3. 终端注册 + 心跳

```text
1) 首次启动 Agent → 自动调 POST /auth/terminal/register
   → 后端返回 terminalId + agentToken + actionTokenSecret
2) Agent 用 Windows DPAPI 加密保存 token（LocalMachine scope，存 agent.token，
   设计文档 §7.1 / Phase 8.1C）——明文不落盘
3) 把返回的 terminalId 回填到 config.json（如未自动写入）
4) 心跳每 30s：PUT /terminals/:id/heartbeat
```

验收（checklist §5.4）：
- [ ] Agent 能访问生产/预生产 API
- [ ] 终端注册成功，`terminalId` 已记录
- [ ] 心跳持续上报
- [ ] **Admin 终端管理页显示该终端在线**
- [ ] 打印机状态 / WMI 状态可上报（缺纸 / 墨粉 / 卡纸，设计文档 §8.2B）
- [ ] 断网后状态变离线；恢复网络后自动重新在线

DPAPI 换机校验（设计文档 V11）：把 `agent.token` 拷到另一台机器应**无法解密**；
普通用户读 `%ProgramData%\AIJobPrintAgent\` 应被 ACL 拒绝。

---

## 4. Windows 服务安装 + 自启 + 单实例

```text
服务名：AIJobPrintAgent      显示名：AI 求职打印服务 - 终端代理
```

```powershell
# 安装 / 卸载（设计文档 §9 Phase 8.1，node-windows）
node dist/index.js install-service
node dist/index.js uninstall-service

# 运维命令行（设计文档 §8.4）
agent-ctl status | start | stop | restart | logs

# 本机状态查询（需 localAuthToken）
# GET http://127.0.0.1:9527/local/status
```

验收（checklist §5.3）：
- [ ] 服务安装成功，可开机自启（重启机器后 30s 内 Running）
- [ ] 崩溃自动重启（失败操作：30s→60s→120s，设计文档 §8.3）
- [ ] **单实例保护**：同时启两个实例，第二个写 `DUPLICATE_INSTANCE` 后 exit 1（设计文档 §8.8）
- [ ] 日志路径固定 `%ProgramData%\AIJobPrintAgent\logs\`，**不含用户文件正文 / 密钥**（§7.5）

---

## 5. 本地 Kiosk ↔ Agent 通信安全

验收（checklist §5.5 / 设计文档 §4.8 actionToken）：
- [ ] Kiosk 从生产域名打开，全屏模式无系统弹窗阻断主流程
- [ ] `http://127.0.0.1:9527` 仅本机可访问（外部访问应失败）
- [ ] localAuthToken / actionToken 校验有效
- [ ] **拒绝**：token 过期 → 403、nonce 重放 → 403、action 不匹配 → 403、签名错误 → 403
- [ ] 页面展示的设备状态与 Agent 上报一致

---

## 6. 真机打印验收（核心，逐项留证）

> 打印流程：后端建任务(pending) → 签发 actionToken → Agent 5s claim → 下载 + MD5 校验
> → 打印 → PATCH 状态回传（设计文档 §5）。每项留打印实物 + 订单状态截图。

| # | 测试 | 通过标准 |
|---|---|---|
| 1 | 打印测试 PDF（1 页 A4） | 出纸正确，订单 `completed` |
| 2 | 打印测试图片（JPG/PNG → pdfkit 转 PDF） | 出纸正确 |
| 3 | 打印简历 PDF | 出纸正确，排版无错位 |
| 4 | 份数控制 | 实际份数 = 设置份数 |
| 5 | 黑白打印 | 输出黑白 |
| 6 | **彩色打印** | 硬件支持；**本地驱动彩色参数必须真机实测**（CLAUDE.md §3 表） |
| 7 | **自动双面** | 硬件支持；**DEVMODE 双面参数必须真机实测** |
| 8 | 打印失败回传 | 任务 `failed`，Kiosk /「我的打印订单」可见 |
| 9 | 打印完成回传 | 任务 `completed`，打印订单可见 |
| 10 | 断网中产生任务 | 不伪造成功；恢复后按 `pending_patches` 队列重试 / 重新 claim，`completed` 只上报一次（设计文档 §7.7 / V14） |

默认纸张 A4，**不假设 A3**（CLAUDE.md §3）。

---

## 7. 扫描 / U 盘 / 外设（按实际能力，不能宣称未接入的闭环）

> ⚠️ checklist §5.7：若扫描 / U 盘仍未真实接入「我的」，**不得在页面宣称已闭环**。
> 扫描任务（Named Pipe → Helper → TWAIN → PDF 合并 → 上传）为 Phase 8.2+，
> 换机时按当时实现状态如实验收，未实现项标「未接入」。

- [ ] TWAIN/WIA 扫描驱动可用，或 SMB/FTP 扫描目录（`smbScanDir`）可用
- [ ] ADF 扫描测试通过，结果生成 PDF/图片
- [ ] 扫描文件上传后端/COS → 进「我的文档」
- [ ] 扫描失败有明确提示，不伪造文件
- [ ] U 盘插入识别 / 文件列表 / 导入打印路径可用
- [ ] 扫码器（如接入）输入不污染其他页面输入框

---

## 8. 执行后回填

1. 回 [checklist §五](./production-deployment-and-windows-host-checklist.md) 逐项打勾。
2. 记录：Windows 版本、打印机真实识别名、Agent 版本、彩色/双面真机实测结论。
3. 发现的问题写入 `docs/progress/current-progress.md`（遵 CLAUDE.md §7，不另起临时 handoff）。
