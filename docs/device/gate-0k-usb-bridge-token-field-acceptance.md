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
| 公网 / 本机 nginx Kiosk bundle | `index-BJahFNHZ.js`（**已覆盖**此前 #413 的 `index-DeG21wry.js`） |
| bundle 内 `VITE_TERMINAL_AGENT_BRIDGE_TOKEN` | 仅构建键名引用；**无**非空字面量 → `isUsbImportConfigured()=false` → UI「本机未配置」 |
| B1 诚实文案「可创建扫描任务」 | **当前 live 包缺失**（被后续热更冲掉）→ 本包热更须从含 #413 的 `main` 重建，一并恢复 |
| API health | `ok/postgres` |
| `PRINT_SCAN_CAPABILITY_MODE` | `managed`（`usb_import` 能力行空表不挡 API） |

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

配置路径（二选一）：

| 安装方式 | 配置 |
|----------|------|
| 正式服务 | `%ProgramData%\AIJobPrintAgent\agent-config.json` |
| 仓库目录跑 | `<repo>\apps\terminal-agent\config\agent-config.json` |

必填：

```json
"localApiBridgeToken": "<与 Kiosk 构建同一值>",
"localApiAllowedOrigins": [
  "https://zyidai.cn",
  "http://127.0.0.1:5173"
]
```

从预发主机取令牌（在一体机或运维机执行，勿贴输出）：

```powershell
# 示例：scp 后写入配置（自行替换路径；不要把 token 回贴聊天）
# scp root@<preprod>:/root/ai-job-print-secrets/kiosk-local-bridge-token $env:TEMP\kiosk-bridge.token
```

然后：

```powershell
Restart-Service AIJobPrintAgent
Start-Sleep -Seconds 3
Get-Service AIJobPrintAgent | Format-List Status, StartType
netstat -ano | findstr "9527"
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

- [ ] Kiosk 热更自含 #413 的 `main`，且注入 bridge token（`DEPLOY_SOURCE` 有 `usb_bridge_token=injected`）
- [ ] Agent `localApiBridgeToken` 与 Kiosk 一致；`localApiAllowedOrigins` 含 `https://zyidai.cn`
- [ ] U 盘 tab 可用；枚举 + 上传一笔成功
- [ ] 进度文档已记旁证；**无** token 明文入仓

## 回执模板（脱敏）

```text
GATE_0K_USB_BRIDGE 回执
日期：
Kiosk bundle：
usb_bridge_token=injected：是/否
Agent localApiBridgeToken 已写：是/否
allowedOrigins 含 zyidai.cn：是/否
U 盘枚举：通过/失败
U 盘上传 fileId：（可打码）
阻塞：
```
