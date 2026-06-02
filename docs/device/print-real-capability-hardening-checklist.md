# 真实打印能力收口版 — Windows 真机验证 Checklist

> 关联分支：`feat/kiosk-print-real-capability-hardening` @ `6e34b5e`（基于 main `5e612b3`）
> 方案②：wire 字段名 `fileMd5` 实际承载 **SHA-256**（files 服务计算 → Kiosk 上送 → Agent SHA-256 比对）。
> 状态机：`pending → claimed → printing → completed | failed`（终态幂等，合法转换受校验）。
> 本文档用于真机逐项验证；全部通过后方可 review → FF 合入 main。

## 1. 验证目标

1. 修复后真实上传文件能稳定打印（SHA-256 校验对齐，不再 100% `DOWNLOAD_HASH_MISMATCH`）。
2. 真实生效参数（copies / duplex / orientation / scale / pageRange / black_white）出纸与设置一致。
3. 彩色（colorMode=color）真机表现确认（真彩 / 驱动默认 / 不可控）。
4. 打印机异常（未找到 / 离线 / 缺纸）在打印前预检即给出明确 errorCode 与中文提示，不再等 5 分钟超时。
5. 篡改文件触发 `DOWNLOAD_HASH_MISMATCH`；打印中重启 Agent 不重复出纸（幂等）。
6. 不破坏既有打印链路（无回归）。

## 2. 前置环境

| 项 | 要求 |
|---|---|
| 一体机 | Windows 10 21H2+ / Windows 11 x64 |
| 打印机 | 奔图 CM2800ADN/CM2820ADN，驱动名 `Pantum CM2800ADN Series`，有纸、在线 |
| Node / pnpm | Node ≥ 18、pnpm ≥ 9 |
| PowerShell | RemoteSigned（WMI 预检依赖）|
| 后端 .env | `TERMINAL_ADMIN_SECRET` / `TERMINAL_ACTION_TOKEN_SECRET` / `FILE_SIGNING_SECRET`(≥32) / `FILE_STORAGE_DIR` / `DATABASE_URL` 已配 |
| 网络 | Kiosk/Agent 能访问后端 `:3010`；Agent 注意绕过本机代理（已内置 `proxy:false`）|

> 提醒：若 Windows 装了 Clash/v2ray 等 `http_proxy`，Agent 已用 `proxy:false` 规避；后端/Kiosk 同机或局域网直连。

## 3. API / Kiosk / Agent 启动命令

**后端 API**

```
pnpm --filter ./services/api build
node services/api/dist/main.js          # → http://<API_HOST>:3010/api/v1
# 或开发：pnpm --filter ./services/api dev
```

**Kiosk**（`apps/kiosk/.env.local`）

```
VITE_API_MODE=http
VITE_API_BASE_URL=/api/v1
VITE_API_PROXY_TARGET=http://<API_HOST>:3010     # dev 代理；生产按部署改
VITE_TERMINAL_ID=<注册后得到的 terminalId>
VITE_PRINTER_NAME=Pantum CM2800ADN Series
```

```
pnpm --filter @ai-job-print/kiosk dev            # → http://localhost:5173
```

**Terminal Agent**（Windows）

```
pnpm --filter ./apps/terminal-agent build
pnpm --filter ./apps/terminal-agent list-printers   # 确认 "Pantum CM2800ADN Series" 状态 Normal
pnpm --filter ./apps/terminal-agent agent           # 首次注册需 adminSecret；之后心跳+claim
# Agent 配置：apiBaseUrl=http://<API_HOST>:3010/api/v1, terminalCode, printerName="Pantum CM2800ADN Series"
```

> 记录注册返回的 `terminalId`，填入 Kiosk 的 `VITE_TERMINAL_ID`。

## 4. 样例文件准备

| 文件 | 用途 | 制作 |
|---|---|---|
| `C:\test\sample-1p.pdf` | 单页 PDF 基础打印 | Word 另存为 PDF |
| `C:\test\sample-3p.pdf` | 多页（≥3 页）：pageRange / duplex / scale | 任意 3+ 页 A4 PDF |
| `C:\test\color.pdf` | 彩色：colorMode=color 验证 | 含明显彩色色块/图片的 PDF |
| `C:\test\sample.jpg` / `sample.png` | 图片打印（pdfkit→PDF）| A4 比例图片 |
| 内置 seed | `ptask_seed_001` → `/api/v1/test/sample-visible.pdf`（后端生成，fileMd5 已为 SHA-256）| 无需准备 |

> 节约墨粉：黑白项用纯文字 PDF；彩色项单独 1 张。

## 5. 正向验证项

> 标准链路：Kiosk 上传 → 设置参数 → 确认 → 后端建任务 → Agent claim → 下载 → **SHA-256 校验** → 打印 → `completed`。可走 Kiosk UI，也可用 curl 直连后端（`POST /api/v1/files/kiosk-upload` 取 `sha256`+`signedUrl` → `POST /api/v1/print/jobs`，`fileMd5` 填 `sha256`）。
>
> **注意：当前 wire 字段名仍为 `fileMd5`，但语义是 SHA-256；直连 `POST /print/jobs` 时 `fileMd5` 必须填写 files 服务返回的 `sha256`。** 若误填 MD5 或留空错误值，会触发 `DOWNLOAD_HASH_MISMATCH`（留空则 Agent 跳过校验，仅供调试，不作为验收路径）。

| # | 项 | 输入 | 关键参数 | 预期 |
|---|---|---|---|---|
| P1 | **真实上传 PDF → SHA-256 校验 → 出纸 → completed** | sample-1p.pdf | 默认 | Agent 日志 `文件哈希校验通过 (SHA-256) ✓`；出纸；API `completed` |
| P2 | JPG 图片打印 | sample.jpg | 默认 | pdfkit→PDF→出纸；completed |
| P3 | PNG 图片打印 | sample.png | 默认 | 同上 |
| P4 | copies=2 | sample-1p.pdf | copies=2 | 出 **2 份** |
| P5 | duplex_long_edge | sample-3p.pdf | duplex=duplex_long_edge | 长边翻转**双面** |
| P6 | orientation=landscape | sample-1p.pdf | orientation=landscape | **横向**输出 |
| P7 | scale fit / actual | sample-3p.pdf | scale=fit；再 scale=actual | 适合页面 / 原始大小（两次对比）|
| P8 | pageRange=1-2 | sample-3p.pdf | pageRange="1-2" | **仅打 1–2 页** |
| P9 | black_white | color.pdf | colorMode=black_white | **单色**输出 |
| P10 | **colorMode=color** | color.pdf | colorMode=color | 记录是否**真彩**（见 §9）|

## 6. 负向验证项

| # | 项 | 触发方式 | 预期 errorCode | 预期前端提示 |
|---|---|---|---|---|
| N1 | PRINTER_NOT_FOUND | Agent 配置 `printerName` 改为不存在名（如 `NoSuchPrinter`）后提交 | `PRINTER_NOT_FOUND` | 未找到打印机，请联系工作人员检查打印机连接 |
| N2 | PRINTER_OFFLINE | 打印机断电 / 拔网线·USB 后提交 | `PRINTER_OFFLINE` | 打印机离线，请联系工作人员检查电源 / 网线 / USB 后重试 |
| N3 | PAPER_EMPTY | 取出纸盘纸张后提交 | `PAPER_EMPTY` | 打印机缺纸，请联系工作人员补纸后重试 |
| N4 | DOWNLOAD_HASH_MISMATCH | `POST /print/jobs` 时 `fileMd5` 填错误值（或上传后篡改文件）| `DOWNLOAD_HASH_MISMATCH` | 文件校验未通过（上传可能中断或文件已变化），请返回重新上传后再打印 |
| N5 | 重启 Agent 不重复出纸 | 见下方加粗说明 | —（不再出纸）| —（任务状态不回退）|

> N1–N3 由打印前 `getPrinterPreflight`（WMI）拦截，应**秒级**失败而非 5 分钟超时。
>
> **N5 收紧定义：任务未完成时重启 Agent 不应重复出纸；已完成任务重启后只保持 `completed`，不重复打印。** 依赖 Agent 本地 SQLite `print_tasks` 幂等（`isTaskDone` 命中跳过；`markTaskDone` 先于 PATCH）。验证两种时序：(a) 打印完成（已 `markTaskDone`）后重启 → 任务保持 `completed`、不再出纸；(b) 打印中（`markTaskDone` 之前）杀进程重启 → 重启后不应对同一任务重复出纸，任务最终状态不回退、不产生第二份纸。

## 7. 每项记录格式（逐项填写）

```
### [P1] 真实上传 PDF → SHA-256 → 出纸
- taskId        : ptask_kiosk_________
- 输入文件      : C:\test\sample-1p.pdf  (size ____ KB)
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=auto scale=fit pageRange=all
- 预期          : SHA-256 校验通过 → 出 1 份 → completed
- 实际          : ___________________________________
- 前端提示      : （成功无错误 / 失败显示：__________________）
- Agent 日志关键行:
    [..] task ...: downloaded (__ KB)
    [..] task ...: 文件哈希校验通过 (SHA-256) ✓
    [..] task ...: printing on "Pantum CM2800ADN Series"...
    [..] task ...: print success in ___ms ✓
    [..] task ...: PATCH status=completed ✓
- API 状态      : GET /print/jobs/{taskId} → status=completed  (errorCode=—)
- 是否通过      : ✅ / ❌  备注：______________
```

> 负向项把"前端提示"填实际中文、"Agent 日志关键行"填 `hash mismatch (SHA-256)` 或 `printer pre-flight failed — <CODE> (<state>)`、"API 状态"填 `status=failed errorCode=<CODE>`。

## 8. 合入 main 的通过条件

全部满足方可 FF 合入 main：

1. **P1 必过**：真实上传文件 SHA-256 校验通过并真实出纸（修复致命缺口）。
2. P2–P9 全过：参数（份数/双面/方向/缩放/页码/黑白）出纸与设置一致。
3. P10 有明确结论：彩色真彩 → 保留；不可控 → 执行 §9 处理并相应调整文案/开关。
4. N1–N4 各自返回正确 errorCode + 对应中文提示，且 N1–N3 为**秒级**预检失败。
5. N5 幂等成立：未完成任务重启不重复出纸，已完成任务重启保持 `completed`。
6. 无回归：黑白/copies/duplex 等既有行为与收口前一致；三端 typecheck/lint/build 仍全过。
7. 验证结果回填本文档并更新 `docs/progress/current-progress.md`。

## 9. 如果彩色打印不稳定，后续处理建议

按成本从低到高，任选其一并复测 P10：

1. **显式色彩参数**：在 Agent `mapParams()` 对 `colorMode==='color'` 显式传 SumatraPDF `-print-settings color`（黑白已用 `monochrome`/`grayscale`）；真机复测是否真彩。
2. **DEVMODE 兜底**：SumatraPDF 不可控时，改用 Win32 `SetPrinter` + `DEVMODE.dmColor`（较重，Windows 专属）。
3. **不可控则降级**：保留现有诚实提示「彩色效果以设备支持和当前耗材状态为准」；并二选一——
   - 暂时**隐藏/锁定彩色选项**（默认黑白），与 quality/pagesPerSheet 一致处理；或
   - 保留彩色但 UI 明示「彩色以设备实际输出为准，可能按黑白处理」。
4. 任何情况下**不得**宣称"保证彩色/真彩"；奔图开放云打印 API 的彩色 `mode` 仍待厂家确认（不在本阶段）。
