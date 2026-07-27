# Gate 0k — U 盘本地桥接令牌现场包

> 最后更新：2026-07-27  
> 授权包名建议：`GATE_0K_USB_BRIDGE`  
> 终端：`t_ksk_001` / `KSK-001`  
> 范围：为 Kiosk + Terminal Agent 配置**同一** `localApiBridgeToken` / `VITE_TERMINAL_AGENT_BRIDGE_TOKEN`，打通 `/local/usb/*`（顺带加固本机 `/local/qr-login/*`）  
> **不在本包**：TWAIN、支付、F1 Genesis、把 token 写入 Git / 聊天

关联：

- 总清单：`docs/device/production-deployment-and-windows-host-checklist.md` §5.3 / §5.7
- SMB 扫描旁证：`docs/device/gate-0k-smb-scan-field-acceptance.md`
- 代码：`apps/kiosk/src/services/files/usbImportApi.ts`、`apps/terminal-agent/src/local-api/origin-guard.ts`

---

## 边界

| 阶段 | 谁做 | 内容 |
|------|------|------|
| **Phase R** | 可 SSH 预发 | 确认现网 Kiosk **未**注入非空 bridge token；生成令牌；Kiosk-only 热更 |
| **Phase W** | 一体机 Windows | Agent `localApiBridgeToken` + `localApiAllowedOrigins` 含 Kiosk 公网 Origin；重启服务；插 U 盘冒烟 |

威胁模型诚实边界：令牌会进 Kiosk 静态包明文；挡的是「未配置 / 误调用」，**不是**本机任意进程读盘。详见 `origin-guard.ts` 注释。

禁止：

- 把完整 token 贴进聊天、PR、进度文档或 `DEPLOY_SOURCE.txt`
- 只热更 Kiosk、不改 Agent（或反过来）导致半开
- 未配置时把 U 盘 tab 伪装成可用

---

## Phase R — 远程旁证（2026-07-27）

| 检查 | 结果 |
|------|------|
| 公网 / 本机 nginx Kiosk bundle | **已热更** `index-DmcUs_Nb.js`（`usb_bridge_token=injected`；备份 `kiosk-dist-before-usb-bridge-20260727T221505+0800`） |
| bundle 内 bridge token | 已注入非空字面量（**勿**在聊天/文档回显）；产物含 `X-Local-Bridge-Token` 路径与 B1「可创建扫描任务」 |
| 预发 secret 文件 | `/root/ai-job-print-secrets/kiosk-local-bridge-token` 存在（`chmod 600`，64 字节级） |
| API health | `ok/postgres` |
| `PRINT_SCAN_CAPABILITY_MODE` | `managed`（`usb_import` 能力行空表不挡 API） |

> Phase R 已完成。半开风险只剩：Windows Agent 尚未写入同一 token / Origin。

---

## 令牌与热更步骤（运维）

1. 在预发主机生成 32+ 字节随机令牌，写入仅 root 可读文件，例如：  
   `/root/ai-job-print-secrets/kiosk-local-bridge-token`（`chmod 600`）  
   **不要** `cat` 到聊天。
2. 用含 B1 的 `main` 构建 Kiosk：  
   `VITE_API_MODE=http`  
   `VITE_API_BASE_URL=/api/v1`  
   `VITE_USE_TRTC_CALL=true`  
   `VITE_TERMINAL_ID=KSK-001`  
   `VITE_TERMINAL_AGENT_BRIDGE_TOKEN=<from secret file>`  
   可选：`VITE_TERMINAL_AGENT_LOCAL_URL=http://127.0.0.1:9527`
3. `verify:prod-build-config` 通过后，按 #400/#413 同口径只替换 `apps/kiosk/dist`；`DEPLOY_SOURCE.txt` 只记 `kiosk_hotfix_pr` / bundle / `usb_bridge_token=injected`（**无明文**）。
4. 公网复验：HTML/JS 200；产物含非空 bridge header 路径；USB tab **不再**写死「本机未配置」（需一体机 Origin + Agent 才真正可用）。

---

## Phase W — Windows Agent

配置路径（正式服务）：`%ProgramData%\AIJobPrintAgent\agent-config.json`  
（仓库目录跑才用 `<repo>\apps\terminal-agent\config\agent-config.json`。）

推荐用脚本（**不打印 token**）：`apps/terminal-agent/scripts/configure-local-bridge-token.ps1`

### W1 取令牌（一体机或运维机，勿贴输出）

```powershell
# 示例：从预发 scp 到本机临时文件（自行替换主机；不要把 token 回贴聊天）
scp root@120.48.13.190:/root/ai-job-print-secrets/kiosk-local-bridge-token $env:TEMP\kiosk-bridge.token
```

### W2 写入配置并重启服务（管理员 PowerShell）

在已拉取含本脚本的仓库目录，或把该 `.ps1` 拷到一体机后执行：

```powershell
cd <repo>\apps\terminal-agent\scripts

# 只读检查（不改文件）
powershell -NoProfile -ExecutionPolicy Bypass -File .\configure-local-bridge-token.ps1 `
  -TokenFile $env:TEMP\kiosk-bridge.token -WhatIfCheck

# 写入 + 重启服务
powershell -NoProfile -ExecutionPolicy Bypass -File .\configure-local-bridge-token.ps1 `
  -TokenFile $env:TEMP\kiosk-bridge.token -RestartService

Remove-Item -LiteralPath $env:TEMP\kiosk-bridge.token -Force -ErrorAction SilentlyContinue
Get-Service AIJobPrintAgent | Format-List Status, StartType
netstat -ano | findstr "9527"
```

必填语义（脚本会合并 Origin，不覆盖其它已有 Origin）：

```json
"localApiBridgeToken": "<与 Kiosk 构建同一值>",
"localApiAllowedOrigins": [
  "https://zyidai.cn",
  "http://127.0.0.1:5173",
  "http://localhost:5173"
]
```

Agent 日志期望：本地网桥监听 `127.0.0.1:9527`；**不应**再刷「localApiBridgeToken not configured」。

### W 冒烟

1. 一体机全屏打开 `https://zyidai.cn/print/upload`（或简历打印同源上传）
2. U 盘 tab：**不是**「本机未配置」
3. 插入含 PDF/JPG/PNG（≤15MB）的 U 盘 → 列表出现文件名（无绝对路径）
4. 选文件上传 → 进入后续打印预览/确认（真实 `fileId`）
5. 拔盘后再刷新：列表应变空或不可用，不得假成功

---

## 通过标准

- [x] Kiosk 热更自含 #413 的 `main`，且注入 bridge token（`DEPLOY_SOURCE` 有 `usb_bridge_token=injected`；bundle `index-DmcUs_Nb.js`）
- [x] Agent `localApiBridgeToken` 已写；`localApiAllowedOrigins` 含 `https://zyidai.cn`；服务 Running + `127.0.0.1:9527`；同 Origin `/local/usb/status` 200（2026-07-27 脱敏回执）
- [ ] U 盘 tab 在**一体机 Edge/Chrome** 下枚举 + 上传一笔成功（当时 `UsbPresent=false`；内置浏览器拦截 loopback 不作数）
- [x] 进度文档已记旁证；**无** token 明文入仓

## 回执（脱敏，2026-07-27）

```text
GATE_0K_USB_BRIDGE 回执
日期：2026-07-27
Kiosk bundle：index-DmcUs_Nb.js
usb_bridge_token=injected：是
Agent localApiBridgeToken 已写：是
allowedOrigins 含 zyidai.cn：是
服务/端口：AIJobPrintAgent Running；127.0.0.1:9527
/local/usb/status：同 Origin 200；CORS/PNA 预检通过
U 盘枚举：未做（UsbPresent=false，未插介质）
U 盘上传：未做
阻塞：仍需一体机 Edge/Chrome + 真实介质（含测试 PDF/图片）做枚举与上传；内置浏览器 loopback 拦截不作数
安全：令牌临时文件与配置备份已删；SCP 主机私钥 ACL 已收紧
```
