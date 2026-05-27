# Phase 8.0 本地打印 Spike

> 目标：在 Windows 主机上验证 Terminal Agent 能否稳定把本地文件打印到奔图 CM2820ADN，并拿到可用的任务状态。  
> 范围：仅本地打印，不涉及云打印、扫描、Kiosk 前端对接。  
> 代码位置：`apps/terminal-agent/`  
> **声明：未在 Windows 真机完成 V01–V15 验证前，不声明生产可用，不进入 Phase 8.1。**

---

## 0. Windows 验证环境准备

### 0.1 运行时要求

| 组件 | 要求 | 验证命令 |
|------|------|---------|
| Windows 版本 | Windows 10 21H2+ 或 Windows 11 | `winver` |
| Node.js | ≥ 18 LTS（推荐 Node.js 20 LTS） | `node -v` |
| pnpm | ≥ 9.x | `pnpm -v` |
| PowerShell | ≥ 5.1（内置）或 PowerShell 7 | `$PSVersionTable` |
| 磁盘空间 | project 目录 ≥ 500 MB（含 node_modules） | — |

### 0.2 PowerShell 执行策略

默认策略 `Restricted` 会阻止脚本执行。以**管理员身份**运行 PowerShell，执行一次：

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

> 说明：`RemoteSigned` 允许本地脚本执行；从网络下载的脚本需要有效签名。  
> 验证：`Get-ExecutionPolicy -List` — `CurrentUser` 行显示 `RemoteSigned` 即可。

### 0.3 奔图 CM2820ADN 驱动安装

**要求**：
- 从奔图官网下载 CM2820ADN Windows 驱动（含彩色激光 PCL/GDI 驱动）
- 安装后打印机必须出现在"打印机和扫描仪"中，名称为 `Pantum CM2820ADN`
- 在"打印机属性 → 高级"中确认驱动名称（`list-printers` 依赖此名称做精确匹配）

**连接方式（二选一）**：

| 方式 | 设置 | 注意 |
|------|------|------|
| **有线网络（推荐）** | 打印机设置固定 IP，Windows 添加 TCP/IP 端口 | 确认防火墙开放 9100 端口 |
| USB | USB-B 转 USB-A 直连 | 驱动安装时选择 USB 端口 |

**验证驱动安装**（安装后，无需运行 Agent）：
```powershell
Get-Printer | Where-Object { $_.Name -like "*Pantum*" } | Select-Object Name, DriverName, PortName, PrinterStatus
```
预期：显示 `Pantum CM2820ADN`，`PrinterStatus` 为 `Normal`。

### 0.4 测试文件准备

在 Windows 主机上准备以下文件，建议放在 `C:\test\` 目录：

| 文件 | 用途 | 制作方法 |
|------|------|---------|
| `sample.pdf` | V02、V05、V07、V11 | 任意 1–2 页 A4 PDF；可用 Word 另存为 PDF |
| `sample.jpg` | V03、V06 | 任意 JPG 图片（建议 A4 比例）|
| `sample.png` | V04 | 任意 PNG 图片 |
| `sample.docx` | V09 | 任意 Word 文件（用于触发 UNSUPPORTED_FILE_TYPE）|

> **节约墨粉**：测试用 PDF 建议只含文字，不含大面积彩色图形。  
> V02–V05 每次出纸 1 张，全套 V01–V11 预计消耗 ≤ 8 张 A4。

### 0.5 项目获取与安装

```powershell
# 1. 将项目复制到 Windows（通过 USB/网络共享/git clone）
# 2. 进入项目根目录（确认有 pnpm-workspace.yaml 和 apps/terminal-agent/）
cd "C:\path\to\ai-job-print-terminal"

# 3. 安装依赖
pnpm install

# 4. 确认 terminal-agent 包已构建
pnpm --filter terminal-agent build
# 预期：dist/ 目录生成，无 TypeScript 错误
```

---

## 1. 两种打印方式对比

| 维度 | Method A — PowerShell | Method B — pdf-to-printer |
|------|----------------------|--------------------------|
| 实现 | `Start-Process -Verb PrintTo` | SumatraPDF 内置二进制 |
| 依赖 | 无额外依赖 | npm `pdf-to-printer`（~6 MB，内含 SumatraPDF.exe）|
| PDF 支持 | 需要系统安装 PDF 阅读器或 Windows 内置 Edge PDF | 始终可用（SumatraPDF 内置）|
| 图片支持 | JPG/PNG/BMP/TIFF ✓（Windows Photo Viewer）| ✗（SumatraPDF 不处理普通图片）|
| 指定打印机 | 通过 PrintTo verb 参数传入 | 通过 `-print-to "name"` 参数 |
| 等待语义 | -Wait 等待宿主进程退出，非等打印完成 | SumatraPDF 退出 ≈ 提交到 spooler |
| 注册表依赖 | 文件类型必须注册 PrintTo verb | 无 |
| 推荐场景 | 图片打印、无需额外包 | PDF 可靠打印（首选）|

---

## 2. 错误码定义

| 错误码 | 触发条件 |
|--------|---------|
| `PRINTER_NOT_FOUND` | `Get-Printer` 中不存在目标打印机名称 |
| `FILE_NOT_FOUND` | `fs.existsSync` 返回 false |
| `UNSUPPORTED_FILE_TYPE` | 文件扩展名不在支持列表（或 Method B 传入图片）|
| `PRINT_COMMAND_FAILED` | PowerShell/SumatraPDF 返回非零退出码 |
| `PRINT_TIMEOUT` | 超过 60 s（`PRINT_TIMEOUT_MS`）进程未退出 |
| `UNKNOWN_PRINT_ERROR` | 其他未分类异常 |

---

## 3. 验证清单

在 Windows 主机上按序执行以下验证，逐项记录结果：

### V01 — 打印机识别

```powershell
pnpm --filter terminal-agent list-printers
```

- [ ] 输出列表中包含 `Pantum CM2820ADN`
- [ ] 状态显示为 `Normal`（不是 `Offline`）

---

### V02 — Method A：打印 PDF

```powershell
pnpm --filter terminal-agent print --file "C:\path\to\sample.pdf" --printer "Pantum CM2820ADN" --method a
```

- [ ] 终端输出 `Method A — PowerShell Start-Process -Verb PrintTo`
- [ ] 终端显示 `✓ SUCCESS`
- [ ] 纸张从打印机出纸
- [ ] 日志包含打印机名称、文件路径、耗时

**预期失败情形**：若系统未安装 PDF 阅读器且 Edge PDF Viewer 被禁用，会返回 `PRINT_COMMAND_FAILED`。

---

### V03 — Method A：打印 JPG

```powershell
pnpm --filter terminal-agent print --file "C:\path\to\sample.jpg" --printer "Pantum CM2820ADN" --method a
```

- [ ] 终端显示 `✓ SUCCESS`
- [ ] 纸张从打印机出纸（彩色）

---

### V04 — Method A：打印 PNG

```powershell
pnpm --filter terminal-agent print --file "C:\path\to\sample.png" --printer "Pantum CM2820ADN" --method a
```

- [ ] 纸张正常出纸

---

### V05 — Method B：打印 PDF

```powershell
pnpm --filter terminal-agent print --file "C:\path\to\sample.pdf" --printer "Pantum CM2820ADN" --method b
```

- [ ] 终端输出 `Method B — pdf-to-printer (SumatraPDF)`
- [ ] 终端显示 `✓ SUCCESS`
- [ ] 纸张从打印机出纸

---

### V06 — Method B：图片应返回 UNSUPPORTED_FILE_TYPE

```powershell
pnpm --filter terminal-agent print --file "C:\path\to\sample.jpg" --printer "Pantum CM2820ADN" --method b
```

- [ ] 终端显示 `✗ FAILED`
- [ ] 错误码：`UNSUPPORTED_FILE_TYPE`

---

### V07 — 错误码：FILE_NOT_FOUND

```powershell
pnpm --filter terminal-agent print --file "C:\not-exist.pdf" --printer "Pantum CM2820ADN"
```

- [ ] 终端显示 `FILE_NOT_FOUND`
- [ ] 进程退出码非零（exit 1）

---

### V08 — 错误码：PRINTER_NOT_FOUND

```powershell
pnpm --filter terminal-agent print --file "C:\path\to\sample.pdf" --printer "NonExistentPrinter"
```

- [ ] 终端显示 `PRINTER_NOT_FOUND`
- [ ] 同时列出已安装的打印机

---

### V09 — 错误码：UNSUPPORTED_FILE_TYPE

```powershell
pnpm --filter terminal-agent print --file "C:\path\to\file.docx" --printer "Pantum CM2820ADN"
```

- [ ] 终端显示 `UNSUPPORTED_FILE_TYPE`

---

### V10 — 无残留临时文件

- [ ] 打印完成后 `samples/` 目录中无非 README 文件残留
- [ ] 系统 TEMP 目录（`%TEMP%`）无本 Agent 创建的遗留文件

---

### V11 — 同时测试两种方法

```powershell
pnpm --filter terminal-agent print --file "C:\path\to\sample.pdf" --printer "Pantum CM2820ADN" --method both
```

- [ ] 输出两个 section 各自的结果
- [ ] Spike Result 汇总显示通过数 / 失败数

---

### V12 — Get-PrintJob 活动任务可见

```powershell
Get-PrintJob -PrinterName "Pantum CM2820ADN"
```

在打印进行中时执行：
- [ ] 命令返回 1+ 行打印作业
- [ ] 每行包含 JobId、DocumentName、JobStatus

---

### V13 — Win32_Printer 离线状态可识别

```powershell
Get-CimInstance -ClassName Win32_Printer -Filter "Name='Pantum CM2820ADN'" |
  Select-Object Name, PrinterStatus, DetectedErrorState
```

断开打印机电源或网线后执行：
- [ ] `PrinterStatus` 返回 `5`（Offline）或其他可映射的值
- [ ] 若返回值不在预期范围内，记录原始值，标注为需上报 `UNKNOWN_PRINTER_STATUS`

---

### V14 — Win32_Printer 缺纸状态可识别

移除纸盘中的纸张后执行：
```powershell
Get-CimInstance -ClassName Win32_Printer -Filter "Name='Pantum CM2820ADN'" |
  Select-Object Name, PrinterStatus, DetectedErrorState
```

- [ ] `DetectedErrorState` 返回 `5`（OutOfPaper）或其他可映射的值
- [ ] 若无法得到明确错误码，记录原始值，标注为驱动限制

---

### V15 — 不可识别状态统一为 UNKNOWN_PRINTER_STATUS

如 V13 / V14 无法得到明确错误码：
- [ ] 记录 `PrinterStatus` 和 `DetectedErrorState` 原始数值
- [ ] 确认 Agent 代码路径在此情况下上报 `UNKNOWN_PRINTER_STATUS`，不假装知道状态
- [ ] 确认 Agent 在 WMI 查询失败后最多重试 3 次，之后停止重试

---

## 4. 结果记录表（在 Windows 主机上填写）

> **填写说明**：
> - 结果列：`✅ PASS` / `❌ FAIL` / `⚠️ PARTIAL` / `N/A`
> - 出纸列：`是` / `否` / `N/A`（不涉及实际打印的项）
> - 错误码列：填写终端实际输出的错误码，无错误填 `—`
> - 备注列：填写原始输出摘要、WMI 原始数值、或失败原因

---

**测试环境信息（必填）**

| 项目 | 填写 |
|------|------|
| 填写日期 | |
| 测试主机型号/规格 | |
| Windows 版本（winver） | |
| Node.js 版本（node -v）| |
| pnpm 版本（pnpm -v）| |
| 打印机连接方式 | USB / 有线网络（IP: ________）|
| 驱动版本（设备管理器）| |

---

### V01–V11：打印功能验证

| 编号 | 验证项 | 执行命令摘要 | 预期结果 | 实际结果 | 出纸 | 错误码 | 备注 |
|------|--------|------------|---------|---------|:----:|--------|------|
| V01 | 打印机识别 | `list-printers` | 列表含 CM2820ADN，状态 Normal | | N/A | — | |
| V02 | PDF 出纸（Method A）| `print ... --method a` | SUCCESS，纸张出纸 | | | | |
| V03 | JPG 出纸（Method A）| `print sample.jpg --method a` | SUCCESS，纸张出纸 | | | | |
| V04 | PNG 出纸（Method A）| `print sample.png --method a` | SUCCESS，纸张出纸 | | | | |
| V05 | PDF 出纸（Method B）| `print ... --method b` | SUCCESS，纸张出纸 | | | | |
| V06 | 图片→UNSUPPORTED（B）| `print sample.jpg --method b` | FAILED errorCode=UNSUPPORTED_FILE_TYPE | | N/A | | |
| V07 | FILE_NOT_FOUND | `print C:\not-exist.pdf` | FAILED errorCode=FILE_NOT_FOUND | | N/A | | |
| V08 | PRINTER_NOT_FOUND | `print ... --printer NoSuch` | FAILED errorCode=PRINTER_NOT_FOUND，列出已安装打印机 | | N/A | | |
| V09 | UNSUPPORTED_FILE_TYPE | `print sample.docx` | FAILED errorCode=UNSUPPORTED_FILE_TYPE | | N/A | | |
| V10 | 无残留文件 | 检查 samples/ 和 %TEMP% | 无遗留文件 | | N/A | — | |
| V11 | both 模式汇总 | `print ... --method both` | 两段各自结果 + 汇总通过数 | | | | |

---

### V12–V15：WMI 状态检测验证

| 编号 | 验证项 | 执行命令摘要 | 预期结果 | 实际结果 | PrinterStatus 原始值 | DetectedErrorState 原始值 | 备注 |
|------|--------|------------|---------|---------|:-------------------:|:------------------------:|------|
| V12 | Get-PrintJob 活动任务可见 | `Get-PrintJob -PrinterName "..."` | 打印中时返回 1+ 行，含 JobId/Status | | N/A | N/A | 打印进行中时执行 |
| V13 | 离线状态可识别 | `Get-CimInstance Win32_Printer` | PrinterStatus=7（Offline）或有意义值 | | | N/A | 断电/拔网线后执行 |
| V14 | 缺纸状态可识别 | `Get-CimInstance Win32_Printer` | DetectedErrorState=4（No Paper）或有意义值 | | N/A | | 移除纸盘后执行 |
| V15 | 不可识别→UNKNOWN | 同 V13/V14，但结果无法解析 | 记录原始值，标注 UNKNOWN_PRINTER_STATUS | | | | 若 V13/V14 值明确则填 N/A |

---

### 总体结论（填写后统计）

| 项目 | 结果 |
|------|------|
| V01–V11 通过数 / 总数 | ___ / 11 |
| V12–V15 通过数 / 总数 | ___ / 4 |
| Method A 可用？| 是 / 否 / 受限（说明：________）|
| Method B 可用？| 是 / 否 |
| WMI 状态可可靠读取？| 全部 / 部分（说明：________）/ 不可用 |
| 可进入 Phase 8.1？| **是（V02 或 V05 出纸 + V12 可见）** / 否（阻塞项：________）|

---

## 5. 已知限制与下一步

### Method A 限制

- `-Wait` 等待宿主进程退出，不等打印完成，无法可靠判断"纸已出纸"
- Windows Edge PDF Viewer 在 PrintTo 调用后有时不会自动关闭进程，导致超时
- 部分 Windows Kiosk 锁定策略会禁止 `Start-Process`

### Method B 限制

- 不支持图片格式（需 Method A 补充）
- SumatraPDF 在某些 Windows Server 环境需额外 Visual C++ Redistributable

### 推荐组合策略（供 Phase 8.1 参考）

| 文件类型 | 推荐方式 |
|---------|---------|
| `.pdf` | Method B（pdf-to-printer / SumatraPDF）优先，失败降级 Method A |
| `.jpg` `.jpeg` `.png` `.bmp` `.tiff` | Method A（PowerShell PrintTo）|

### Phase 8.1 候选任务（基于 Spike 结果）

- [ ] 封装统一 `print(file, printer)` API，内部路由 Method A/B
- [ ] 接入 Windows 打印队列 API（WMI `Win32_PrintJob`）轮询任务状态
- [ ] 实现打印任务状态上报（pending → printing → done / failed）
- [ ] 接入后端 `POST /api/v1/terminals/:id/tasks/claim` 接口（Agent-initiated，非后端推送）
- [ ] Named Pipe 架构实现（Service + User Session Helper）

### Phase 8.1 打印任务状态机（Agent 视角）

Agent 采用 **Agent-initiated claim** 模型：Agent 主动轮询领取任务，后端不做主动推送。

```
[后端]  pending
          │  Agent POST /tasks/claim
          ▼
        claimed  ←──── claimExpiresAt 到期自动重置 ──────┐
          │  Agent 下载文件 + MD5 校验                    │
          │  Agent 调用 Windows 打印 API                  │
          ▼                                               │
        printing  (Agent PATCH status=printing)           │
          │                                               │
   ┌──────┴──────┐                                       │
   ▼             ▼                                       │
completed      failed ──── UNKNOWN_PRINTER_STATUS ───────┘
 (PATCH)       (PATCH errorCode)
```

打印状态上报路径：Agent → `PATCH /api/v1/print-tasks/:id/status`

| 上报时机 | status | errorCode |
|---------|--------|-----------|
| 下载完成，开始打印 | `printing` | — |
| `Get-PrintJob` 作业消失 + 无错误 | `completed` | — |
| 打印机离线 / 缺纸 | `failed` | `PRINTER_OFFLINE` / `PAPER_EMPTY` |
| WMI 查询失败 / 状态不可识别 | `failed` | `UNKNOWN_PRINTER_STATUS` |
| claimed 超过 10 分钟 | `failed` | `TIMEOUT` |

---

## 6. 逐步执行命令手册

按以下顺序执行，每步确认输出后再进行下一步。  
假设打印机名称为 `Pantum CM2820ADN`，测试文件位于 `C:\test\`。

---

### Step 1 — 确认打印机驱动（纯 PowerShell，不需要 Node.js）

```powershell
# 列出所有打印机，找到奔图
Get-Printer | Select-Object Name, PrinterStatus, DriverName, PortName

# 精确匹配
Get-Printer -Name "Pantum CM2820ADN"
```

预期：返回对象，`PrinterStatus = Normal`。若报错 "找不到"，先安装驱动。

---

### Step 2 — 确认 Node.js / pnpm 版本

```powershell
node -v       # 应显示 v18.x 或 v20.x
pnpm -v       # 应显示 9.x
```

---

### Step 3 — 安装依赖 & 构建

```powershell
cd "C:\path\to\ai-job-print-terminal"
pnpm install
pnpm --filter terminal-agent build
```

预期：`dist/index.js` 生成，终端无 TypeScript 报错。

---

### Step 4 — 列出打印机（Agent 命令）

```powershell
pnpm --filter terminal-agent list-printers
```

预期输出：
```
Found X printer(s):
  ✓ Pantum CM2820ADN  (Normal)
  ...
```

---

### Step 5 — Method B 打印 PDF（首选，最可靠）

```powershell
pnpm --filter terminal-agent print `
  --file "C:\test\sample.pdf" `
  --printer "Pantum CM2820ADN" `
  --method b
```

预期输出：
```
Method B — pdf-to-printer (SumatraPDF)
✓ SUCCESS  printer=Pantum CM2820ADN  file=C:\test\sample.pdf  duration=XXXms
```

**等待出纸。** 记录是否出纸及耗时。

---

### Step 6 — Method A 打印 PDF（备用方法）

```powershell
pnpm --filter terminal-agent print `
  --file "C:\test\sample.pdf" `
  --printer "Pantum CM2820ADN" `
  --method a
```

预期输出：
```
Method A — PowerShell Start-Process -Verb PrintTo
✓ SUCCESS  ...
```

**等待出纸。** 若 PrintTo verb 未注册，会返回 `PRINT_COMMAND_FAILED`（记录原因）。

---

### Step 7 — Method A 打印图片

```powershell
# JPG
pnpm --filter terminal-agent print `
  --file "C:\test\sample.jpg" `
  --printer "Pantum CM2820ADN" `
  --method a

# PNG
pnpm --filter terminal-agent print `
  --file "C:\test\sample.png" `
  --printer "Pantum CM2820ADN" `
  --method a
```

---

### Step 8 — Method B 传入图片（应返回 UNSUPPORTED_FILE_TYPE）

```powershell
pnpm --filter terminal-agent print `
  --file "C:\test\sample.jpg" `
  --printer "Pantum CM2820ADN" `
  --method b
```

预期：`✗ FAILED  errorCode=UNSUPPORTED_FILE_TYPE`（非出错，属于预期行为）

---

### Step 9 — 错误码验证

```powershell
# FILE_NOT_FOUND
pnpm --filter terminal-agent print `
  --file "C:\test\not-exist.pdf" `
  --printer "Pantum CM2820ADN"

# PRINTER_NOT_FOUND
pnpm --filter terminal-agent print `
  --file "C:\test\sample.pdf" `
  --printer "NoSuchPrinter"

# UNSUPPORTED_FILE_TYPE
pnpm --filter terminal-agent print `
  --file "C:\test\sample.docx" `
  --printer "Pantum CM2820ADN"
```

---

### Step 10 — both 模式汇总

```powershell
pnpm --filter terminal-agent print `
  --file "C:\test\sample.pdf" `
  --printer "Pantum CM2820ADN" `
  --method both
```

预期：输出 Method A 和 Method B 两段结果 + 汇总通过/失败数。

---

### Step 11 — WMI 状态查询（无需 Node.js，纯 PowerShell）

```powershell
# ── 基础状态 ──────────────────────────────────────────────────
Get-CimInstance -ClassName Win32_Printer `
  -Filter "Name='Pantum CM2820ADN'" |
  Select-Object Name, PrinterStatus, DetectedErrorState, WorkOffline

# ── 活动打印任务（打印进行中时运行）──────────────────────────
Get-PrintJob -PrinterName "Pantum CM2820ADN"

# ── Win32_PrintJob 详情（如有活动任务）───────────────────────
Get-CimInstance -ClassName Win32_PrintJob |
  Where-Object { $_.Name -like "*Pantum*" } |
  Select-Object JobId, Document, StatusMask, Status, Size

# ── 离线状态测试（断电或拔网线后执行）───────────────────────
Get-CimInstance -ClassName Win32_Printer `
  -Filter "Name='Pantum CM2820ADN'" |
  Select-Object Name, PrinterStatus, DetectedErrorState, WorkOffline

# ── 缺纸状态测试（移除纸盘后执行）───────────────────────────
Get-CimInstance -ClassName Win32_Printer `
  -Filter "Name='Pantum CM2820ADN'" |
  Select-Object Name, PrinterStatus, DetectedErrorState
```

**Win32_Printer.PrinterStatus 参考值**：

| 值 | 含义 |
|----|------|
| 1 | Other |
| 2 | Unknown |
| 3 | Idle（空闲，正常）|
| 4 | Printing（打印中）|
| 5 | Warmup |
| 6 | Stopped Printing |
| 7 | Offline（离线）|

**Win32_Printer.DetectedErrorState 参考值**：

| 值 | 含义 |
|----|------|
| 0 | Unknown |
| 1 | Other |
| 2 | No Error（正常）|
| 3 | Low Paper |
| 4 | No Paper（缺纸）|
| 5 | Low Toner |
| 6 | No Toner |
| 7 | Door Open |
| 8 | Jammed（卡纸）|
| 9 | Offline |
| 10 | Service Requested |

> **注意**：部分奔图驱动返回值可能与标准不符，记录实际原始值到备注列。  
> 无法解析的值统一标注为 `UNKNOWN_PRINTER_STATUS`（需在 Phase 8.1 代码中处理）。

---

### Step 12 — 无残留文件检查

```powershell
# 检查 samples 目录
Get-ChildItem "C:\path\to\ai-job-print-terminal\apps\terminal-agent\samples\"

# 检查系统 TEMP（搜索 agent 相关文件）
Get-ChildItem $env:TEMP | Where-Object { $_.Name -like "*agent*" -or $_.Name -like "*print*" }
```

---

*Phase 8.0 — 仅用于本地打印 Spike 验证，不接云端 API，不接 Kiosk 前端，不做扫描。*  
*未完成 V01–V15 真机验证前不进入 Phase 8.1。*
