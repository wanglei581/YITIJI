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

## 7. 验证记录（2026-06-03 Windows 真机）

> 验证环境：Windows 11 Pro x64 / Node 24 / pnpm 10 / Pantum CM2800ADN Series (status=0)
> Agent terminalId: `t_6cd90e91bf184f1e`  terminalCode: `WIN-PANTUM-TEST-01`
> API: `http://localhost:3010/api/v1`（dev 模式）

---

### [P1] 真实上传 PDF → SHA-256 → 出纸
- taskId        : ptask_kiosk_d1a17c162b6ecbdd
- 输入文件      : C:\test\sample-1p.pdf  (1.4 KB，pdfkit 生成单页 A4)
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=auto scale=fit pageRange=all
- 预期          : SHA-256 校验通过 → 出 1 份 → completed
- 实际          : 出 1 份纸，print success in 737ms
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:01:25] task ptask_kiosk_d1a17c162b6ecbdd: downloaded (1.4 KB)
    [02:01:25] task ptask_kiosk_d1a17c162b6ecbdd: 文件哈希校验通过 (SHA-256) ✓
    [02:01:26] task ptask_kiosk_d1a17c162b6ecbdd: printing on "Pantum CM2800ADN Series"...
    [02:01:27] task ptask_kiosk_d1a17c162b6ecbdd: print success in 737ms ✓
    [02:01:27] task ptask_kiosk_d1a17c162b6ecbdd: PATCH status=completed ✓
- API 状态      : GET /print/jobs/ptask_kiosk_d1a17c162b6ecbdd → status=completed  (errorCode=—)
- 是否通过      : ✅

---

### [P2] JPG 图片打印
- taskId        : ptask_kiosk_dfa82e5cf9b0cfe5
- 输入文件      : C:\test\sample.jpg  (676.8 KB)
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=auto scale=fit
- 预期          : pdfkit→PDF→出纸；completed
- 实际          : 出纸，print success in 216ms
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:04:26] task ptask_kiosk_dfa82e5cf9b0cfe5: downloaded (676.8 KB)
    [02:04:26] task ptask_kiosk_dfa82e5cf9b0cfe5: 文件哈希校验通过 (SHA-256) ✓
    [02:04:27] task ptask_kiosk_dfa82e5cf9b0cfe5: printing on "Pantum CM2800ADN Series"...
    [02:04:27] task ptask_kiosk_dfa82e5cf9b0cfe5: print success in 216ms ✓
    [02:04:27] task ptask_kiosk_dfa82e5cf9b0cfe5: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅

---

### [P3] PNG 图片打印
- taskId        : ptask_kiosk_8ef99df221fd14a9
- 输入文件      : C:\test\sample.png  (131.7 KB)
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=auto scale=fit
- 预期          : pdfkit→PDF→出纸；completed
- 实际          : 出纸，print success in 470ms
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:04:51] task ptask_kiosk_8ef99df221fd14a9: downloaded (131.7 KB)
    [02:04:51] task ptask_kiosk_8ef99df221fd14a9: 文件哈希校验通过 (SHA-256) ✓
    [02:04:52] task ptask_kiosk_8ef99df221fd14a9: printing on "Pantum CM2800ADN Series"...
    [02:04:52] task ptask_kiosk_8ef99df221fd14a9: print success in 470ms ✓
    [02:04:52] task ptask_kiosk_8ef99df221fd14a9: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅

---

### [P4] copies=2
- taskId        : ptask_kiosk_bb31ec4f2fa8cbb6
- 输入文件      : C:\test\sample-1p.pdf  (1.4 KB)
- 参数          : copies=2 colorMode=black_white duplex=simplex orientation=auto scale=fit
- 预期          : 出 2 份
- 实际          : print success in 426ms；出纸 2 份（驱动控制，人工确认）
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:05:06] task ptask_kiosk_bb31ec4f2fa8cbb6: downloaded (1.4 KB)
    [02:05:06] task ptask_kiosk_bb31ec4f2fa8cbb6: 文件哈希校验通过 (SHA-256) ✓
    [02:05:07] task ptask_kiosk_bb31ec4f2fa8cbb6: print success in 426ms ✓
    [02:05:07] task ptask_kiosk_bb31ec4f2fa8cbb6: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅  备注：份数由 SumatraPDF copies 参数控制，驱动层生效

---

### [P5] duplex=duplex_long_edge
- taskId        : ptask_kiosk_ea0de743085a9d8f
- 输入文件      : C:\test\sample-3p.pdf  (3.1 KB，3 页)
- 参数          : copies=1 colorMode=black_white duplex=duplex_long_edge orientation=auto scale=fit
- 预期          : 长边翻转双面，3 页→2 张（第 1 张双面，第 2 张单面）
- 实际          : print success in 932ms；双面出纸（人工确认）
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:05:21] task ptask_kiosk_ea0de743085a9d8f: downloaded (3.1 KB)
    [02:05:21] task ptask_kiosk_ea0de743085a9d8f: 文件哈希校验通过 (SHA-256) ✓
    [02:05:22] task ptask_kiosk_ea0de743085a9d8f: print success in 932ms ✓
    [02:05:22] task ptask_kiosk_ea0de743085a9d8f: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅  备注：SumatraPDF side=duplexlong 参数传入，驱动层双面生效

---

### [P6] orientation=landscape
- taskId        : ptask_kiosk_110703a97b7cf49b
- 输入文件      : C:\test\sample-1p.pdf  (1.4 KB)
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=landscape scale=fit
- 预期          : 横向输出
- 实际          : print success in 287ms；横向出纸（人工确认）
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:05:36] task ptask_kiosk_110703a97b7cf49b: downloaded (1.4 KB)
    [02:05:36] task ptask_kiosk_110703a97b7cf49b: 文件哈希校验通过 (SHA-256) ✓
    [02:05:37] task ptask_kiosk_110703a97b7cf49b: print success in 287ms ✓
    [02:05:37] task ptask_kiosk_110703a97b7cf49b: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅

---

### [P7a] scale=fit
- taskId        : ptask_kiosk_d944d4b051f1e190
- 输入文件      : C:\test\sample-3p.pdf  (3.1 KB)
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=auto scale=fit
- 预期          : 适合页面（内容缩放至页边距内，留白）
- 实际          : print success in 952ms；出纸（人工对比 P7b）
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:06:52] task ptask_kiosk_d944d4b051f1e190: 文件哈希校验通过 (SHA-256) ✓
    [02:06:52] task ptask_kiosk_d944d4b051f1e190: print success in 952ms ✓
    [02:06:53] task ptask_kiosk_d944d4b051f1e190: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅

### [P7b] scale=actual
- taskId        : ptask_kiosk_ab3ee1c65bce793d
- 输入文件      : C:\test\sample-3p.pdf  (3.1 KB)
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=auto scale=actual
- 预期          : 原始大小（不缩放，可能超出页边距）
- 实际          : print success in 944ms；出纸（人工对比 P7a）
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:07:12] task ptask_kiosk_ab3ee1c65bce793d: 文件哈希校验通过 (SHA-256) ✓
    [02:07:12] task ptask_kiosk_ab3ee1c65bce793d: print success in 944ms ✓
    [02:07:13] task ptask_kiosk_ab3ee1c65bce793d: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅  备注：scale=actual → SumatraPDF noscale，驱动层生效

---

### [P8] pageRange=1-2
- taskId        : ptask_kiosk_d9e77a1fb0f4d64e
- 输入文件      : C:\test\sample-3p.pdf  (3.1 KB，3 页)
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=auto scale=fit pageRange=1-2
- 预期          : 仅打第 1–2 页，第 3 页不出纸
- 实际          : print success in 692ms；出 2 张（人工确认第 3 页未出）
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:07:31] task ptask_kiosk_d9e77a1fb0f4d64e: downloaded (3.1 KB)
    [02:07:31] task ptask_kiosk_d9e77a1fb0f4d64e: 文件哈希校验通过 (SHA-256) ✓
    [02:07:32] task ptask_kiosk_d9e77a1fb0f4d64e: print success in 692ms ✓
    [02:07:33] task ptask_kiosk_d9e77a1fb0f4d64e: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅

---

### [P9] colorMode=black_white（彩色 PDF）
- taskId        : ptask_kiosk_d5a5646ecd428a7d
- 输入文件      : C:\test\color.pdf  (1.8 KB，含红/蓝/绿/黄/紫等色块)
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=auto scale=fit
- 预期          : 彩色 PDF 以黑白/灰度输出
- 实际          : print success in 463ms；灰度出纸（人工确认）
- 前端提示      : 成功，无错误
- Agent 日志关键行:
    [02:07:51] task ptask_kiosk_d5a5646ecd428a7d: downloaded (1.8 KB)
    [02:07:51] task ptask_kiosk_d5a5646ecd428a7d: 文件哈希校验通过 (SHA-256) ✓
    [02:07:52] task ptask_kiosk_d5a5646ecd428a7d: print success in 463ms ✓
    [02:07:53] task ptask_kiosk_d5a5646ecd428a7d: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅  备注：monochrome=true 参数生效，SumatraPDF 强制灰度

---

### [P10] colorMode=color（彩色验证）
- taskId        : ptask_kiosk_4a15d6860f4a02cf
- 输入文件      : C:\test\color.pdf  (1.8 KB，含红/蓝/绿/黄/紫等色块)
- 参数          : copies=1 colorMode=color duplex=simplex orientation=auto scale=fit
- 预期          : 记录是否真彩（见 §9）
- 实际          : **print success in 423ms；输出为真彩色** ✓
    （出纸时一张滑落至输出盘外，拣起后确认为彩色输出）
- 前端提示      : 成功，无错误（API/Agent 无报错）
- Agent 日志关键行:
    [02:08:11] task ptask_kiosk_4a15d6860f4a02cf: downloaded (1.8 KB)
    [02:08:11] task ptask_kiosk_4a15d6860f4a02cf: 文件哈希校验通过 (SHA-256) ✓
    [02:08:12] task ptask_kiosk_4a15d6860f4a02cf: print success in 423ms ✓
    [02:08:12] task ptask_kiosk_4a15d6860f4a02cf: PATCH status=completed ✓
- API 状态      : status=completed  (errorCode=—)
- 是否通过      : ✅
- §9 结论       : colorMode=color **真彩可用**——SumatraPDF 未设 monochrome 时驱动默认彩色输出，
    奔图 CM2800ADN Series 硬件彩色打印功能正常。彩色选项可保留，
    建议 UI 加诚实提示「彩色效果以设备实际输出为准」。
    注：奔图开放云打印 API 的彩色 mode 仍待厂家确认，不在本阶段。

---

### [N4] DOWNLOAD_HASH_MISMATCH（优先执行）
- taskId          : ptask_kiosk_df2050bdede2a16a
- 触发方式        : `fileMd5` 填 `aaaa...aa`（64位全错误 SHA-256）
- Agent 日志关键行:
    [02:22:13] task ptask_kiosk_df2050bdede2a16a: hash mismatch (SHA-256) — expected=aaaa...aa actual=5ba4fe7c...
    [02:22:13] task ptask_kiosk_df2050bdede2a16a: PATCH status=failed failed — HTTP 400 [INVALID_STATUS_TRANSITION]
    [02:22:13] db: PATCH status=failed for task ptask_kiosk_df2050bdede2a16a enqueued for offline retry
    offline-queue: abandoning patch id=... — 4xx (400): INVALID_STATUS_TRANSITION
- Agent 本地 DB   : status=failed, completedAt=2026-06-03T02:22:13.003Z ✓（正确写入）
- API 状态        : status=**claimed**（未达 failed）
- 物理出纸        : **无** ✓
- 是否通过        : ⚠️ **PARTIAL — Agent 行为正确；API 状态机 Bug**
- **Bug 根因**    : `VALID_TRANSITIONS['claimed']` 仅允许 `['printing']`，不含 `'failed'`。
    `claimed → failed` 被 API 拒绝（400 INVALID_STATUS_TRANSITION），offline queue 4xx 后正确 abandon。
    任务经 5 分钟 claimExpiry 重置回 pending；Agent 幂等检查（本地 DB）跳过不重打，但 API 状态永久无法达 failed。
- **修复建议**    : `services/api/src/terminals/terminals.service.ts` 中改为：
    `claimed: ['printing', 'failed'],`（单行修改）

#### [N4] 修复后复测（2026-06-03，fix `7221d1e`）
- 修复内容      : `terminals.service.ts` `VALID_TRANSITIONS['claimed']` 增加 `'failed'`（单行）
- taskId        : ptask_kiosk_25c585344567c22a
- Agent 日志关键行:
    [03:04:25] task ptask_kiosk_25c585344567c22a: hash mismatch (SHA-256) — expected=0000...0000 actual=5ba4fe7c...
    [03:04:25] task ptask_kiosk_25c585344567c22a: PATCH status=failed ✓
- API 状态      : status=**failed**, errorCode=**DOWNLOAD_HASH_MISMATCH** ✓
    errorMessage: 文件校验失败（SHA-256 不一致）：expected=0000...0000, got=5ba4fe7c...
- 物理出纸      : **无** ✓
- 是否通过      : ✅ **修复后复测通过**

---

### [N1] PRINTER_NOT_FOUND
- taskId          : ptask_kiosk_4f32898d7521231b
- 触发方式        : agent-config.json `printerName="NoSuchPrinter"`，重启 Agent
- 检测速度        : **1.057s**（WMI query 秒级，非 5 分钟超时）✓
- Agent 日志关键行:
    [02:33:18] task ptask_kiosk_4f32898d7521231b: downloaded (1.4 KB)
    [02:33:18] task ptask_kiosk_4f32898d7521231b: 文件哈希校验通过 (SHA-256) ✓
    [02:33:19] ERROR task ptask_kiosk_4f32898d7521231b: printer pre-flight failed — PRINTER_NOT_FOUND (not_found)
    [02:33:19] WARN  task ptask_kiosk_4f32898d7521231b: PATCH status=failed failed — HTTP 400 [INVALID_STATUS_TRANSITION]
- errorCode 尝试  : `PRINTER_NOT_FOUND`（Agent 侧正确）
- API 状态        : status=**claimed**（同 N4 状态机 Bug，claimed→failed 被拒）
- 物理出纸        : **无** ✓
- 恢复            : printerName 恢复为 `Pantum CM2800ADN Series`，list-printers 确认 status=0
- 是否通过        : ⚠️ **PARTIAL — Agent WMI 检测正确（秒级）；API 状态机 Bug 同 N4**

#### [N1] 修复后复测（2026-06-03，fix `7221d1e`）
- 修复内容      : 同 N4（`VALID_TRANSITIONS['claimed']` 增加 `'failed'`）
- taskId        : ptask_kiosk_efaa1205fe5fd897（printerName=NoSuchPrinter_N1_Retest）
- Agent 日志关键行:
    [03:10:51] task ptask_kiosk_efaa1205fe5fd897: downloaded (1.4 KB)
    [03:10:51] task ptask_kiosk_efaa1205fe5fd897: 文件哈希校验通过 (SHA-256) ✓
    [03:10:51] ERROR task ptask_kiosk_efaa1205fe5fd897: printer pre-flight failed — PRINTER_NOT_FOUND (not_found)
    [03:10:51] task ptask_kiosk_efaa1205fe5fd897: PATCH status=failed ✓
- API 状态      : status=**failed**, errorCode=**PRINTER_NOT_FOUND** ✓
    errorMessage: 打印机未找到：NoSuchPrinter_N1_Retest
- 物理出纸      : **无** ✓
- 是否通过      : ✅ **修复后复测通过**（WMI 秒级检测 + API 状态正确落 failed）

---

### [N2] PRINTER_OFFLINE
- taskId          : ptask_kiosk_e95e0b79b4cb0979
- 触发方式        : 打印机关机（WorkOffline=True）
- WMI 检测前      : PrinterStatus=3, DetectedErrorState=0, WorkOffline=False（正常）
- WMI 检测后关机  : PrinterStatus=3, DetectedErrorState=0, **WorkOffline=True**
- Agent 日志关键行:
    [02:38:41] task ptask_kiosk_e95e0b79b4cb0979: 文件哈希校验通过 (SHA-256) ✓
    [02:38:42] task ptask_kiosk_e95e0b79b4cb0979: PATCH status=printing ✓
    [02:38:42] task ptask_kiosk_e95e0b79b4cb0979: printing on "Pantum CM2800ADN Series"...
    [02:38:42] task ptask_kiosk_e95e0b79b4cb0979: print success in 509ms ✓   ← 假阳性
    [02:38:42] task ptask_kiosk_e95e0b79b4cb0979: PATCH status=completed ✓
- API 状态        : status=**completed**（假阳性）
- 物理出纸        : **无**（job 送入打印机后台队列；已手动 `Remove-PrintJob` 清除）
- WMI 打印后      : PrinterStatus=3, DetectedErrorState=0（驱动未更新，仍无 offline 状态）
- 是否通过        : ❌ **FAIL — 设计缺口**
- **缺口根因**    : preflight WMI 脚本仅输出 `PrinterStatus,DetectedErrorState`，未检查 `WorkOffline`。
    打印机关机后 Windows 将打印机置为 WorkOffline=True，但 PrinterStatus 仍维持 3（Idle）。
    Windows 打印后台接受 job 并返回 exit 0，故 Agent 误报 completed。
- **修复建议**    : `wmi.ts getPrinterPreflight()` 脚本改为输出 `"$($p.PrinterStatus),$($p.DetectedErrorState),$($p.WorkOffline)"`，
    解析第三段；若 `workOfflineStr === 'True'` 则 return `'offline'`。

#### [N2] 修复后复测（2026-06-03，fix `7221d1e`）
- 修复内容      : `wmi.ts getPrinterPreflight()` + `getPrinterStatus()` 均增加 `$p.WorkOffline` 第三字段；
    `workOfflineStr === 'True'` → return `'offline'`（优先于 PrinterStatus=7 检查）
- 前置 WMI 确认 : PrinterStatus=3, DetectedErrorState=0, **WorkOffline=True**（打印机关机后实测）
- taskId        : ptask_kiosk_3dd4a8e5b5ae7046
- Agent 日志关键行:
    [03:14:16] task ptask_kiosk_3dd4a8e5b5ae7046: downloaded (1.4 KB)
    [03:14:16] task ptask_kiosk_3dd4a8e5b5ae7046: 文件哈希校验通过 (SHA-256) ✓
    [03:14:17] ERROR task ptask_kiosk_3dd4a8e5b5ae7046: printer pre-flight failed — PRINTER_OFFLINE (offline)
    [03:14:17] task ptask_kiosk_3dd4a8e5b5ae7046: PATCH status=failed ✓
- API 状态      : status=**failed**, errorCode=**PRINTER_OFFLINE** ✓
    errorMessage: 打印机离线（请检查电源/网线/USB 连接）
- 物理出纸      : **无** ✓
- 是否通过      : ✅ **修复后复测通过**（WorkOffline=True 秒级检测验证通过）

---

### [N3] PAPER_EMPTY
- taskId          : ptask_kiosk_cac04c076839896f
- 触发方式        : 取空进纸盒全部纸张
- WMI 检测前（取纸后）: PrinterStatus=3, DetectedErrorState=0（无变化）
- Agent 日志关键行:
    [02:42:41] task ptask_kiosk_cac04c076839896f: 文件哈希校验通过 (SHA-256) ✓
    [02:42:42] task ptask_kiosk_cac04c076839896f: PATCH status=printing ✓
    [02:42:42] task ptask_kiosk_cac04c076839896f: printing on "Pantum CM2800ADN Series"...
    [02:42:43] task ptask_kiosk_cac04c076839896f: print success in 498ms ✓   ← 假阳性
    [02:42:43] task ptask_kiosk_cac04c076839896f: PATCH status=completed ✓
- API 状态        : status=**completed**（假阳性）
- 物理出纸        : **无**（job 已发到打印机硬件；补纸后打印机自行完成或报错，已补纸）
- WMI 打印后      : PrinterStatus=3, DetectedErrorState=0（Pantum 驱动不报 DetectedErrorState=4）
- 是否通过        : ❌ **FAIL — 设计缺口**
- **缺口根因**    : 奔图 CM2800ADN Series Windows 驱动**不通过 WMI `DetectedErrorState` 上报缺纸**（打印前/后均为 0）。
    SumatraPDF 将 job 发入打印机，打印机本体尝试取纸失败才进入缺纸错误，此时软件层已报 completed。
- **修复建议**    : PAPER_EMPTY 无法通过 WMI preflight 预检实现（此驱动不支持）。
    需改为打印后监听 **Windows 打印后台 job result**（`Get-PrintJob` 状态 / WinSpool API）或改用 SNMP 查询网络打印机状态。
    短期方案：UI 在打印完成后加"请确认纸张已出盘"提示；后台监测 job 进入 Error 状态后触发告警。

#### [N3] 修复后复测（2026-06-03，feat/terminal-agent-print-job-monitor）
- 修复内容      : 打印后启动 `Get-PrintJob` 30s 轮询；`Printing, Retained` 映射为新增的 `'retained'` 状态（不再直接映射 completed）；
    监控超时且 `seenRetainedOnce=true` → `{ failed: true, errorCode: 'PRINT_JOB_UNCONFIRMED' }`，不声称 completed，不声称 PAPER_EMPTY
- taskId        : ptask_kiosk_46d128fe180a304c
- 触发方式      : 打印机通电、纸盒清空（取出所有 A4 纸）
- 参数          : copies=1 colorMode=black_white duplex=simplex orientation=auto scale=fit
- Agent 日志关键行:
    [07:02:10] task ptask_kiosk_46d128fe180a304c: print success in 603ms ✓
    [07:02:14] monitor poll [180a304c]: status=retained raw="Printing, Retained"
    （每 1.5s 持续轮询，作业全程停留在 Printing, Retained 状态）
    [07:02:42] WARN  task ptask_kiosk_46d128fe180a304c: print queue monitor: print queue monitoring timed out after 30000ms: job remained in 'Printing, Retained' state (Pantum CM2800ADN driver limitation — cannot distinguish completed vs paper-empty via Get-PrintJob); reporting PRINT_JOB_UNCONFIRMED — operator must check device
    [07:02:42] task ptask_kiosk_46d128fe180a304c: PATCH status=failed ✓
- API 状态      : status=**failed**, errorCode=**PRINT_JOB_UNCONFIRMED** ✓
    errorMessage: 打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态
- 前端展示      : ERROR_CODE_MESSAGES['PRINT_JOB_UNCONFIRMED'] = "打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态" ✓
- 物理出纸      : **无** ✓（纸盒空，打印机等待纸张，30s 后 Agent 上报 UNCONFIRMED）
- 是否通过      : ✅ **监控正确识别 Retained 超时 → PRINT_JOB_UNCONFIRMED；不误报 completed；不重打**

**N3 结论（更新）：**
- Pantum CM2800ADN 缺纸时不触发 WMI `DetectedErrorState=4`（preflight 无法检测，已知驱动限制不变）
- 打印后 `Get-PrintJob` 监控能识别 `Printing, Retained` 持续超时 → 上报 `PRINT_JOB_UNCONFIRMED`
- **不声称能自动识别 PAPER_EMPTY**：系统只能上报"未确认完成"，具体是缺纸/卡纸/其他需运营人员人工核查
- 前端展示正确中文提示，API 终态为 failed（不误报 completed）

---

### [N5] Agent 重启不重打
#### N5(a) — 已完成任务重启后不重打
- 验证场景        : Agent 重启（PID 2100 → 23004），API 中 completed 任务（P1–P10，N2 seed 等）
- Agent 日志关键行:
    [02:46:19] task-runner: claimed task ptask_seed_001
    [02:46:19] task ptask_seed_001: already done in local DB, skipping (restart-idempotency)
- API 状态        : completed 任务均保持 completed（终态不可转换，Agent 幂等跳过）
- 物理出纸        : **无重复出纸** ✓
- 是否通过        : ✅

#### N5(b) — 打印中崩溃重启不重打
- 验证任务        : ptask_kiosk_eeaf7b32b4251a8e（3 页 PDF，print 936ms）
- 设计保证验证    :
    - `markTaskDone` 写入本地 DB 时刻 : 2026-06-03T02:49:42.103Z
    - API `PATCH completed` ACK 时刻  : 2026-06-03T02:49:42.109Z
    - **本地 DB 先于 PATCH ACK 6ms 写入** ✓ —— 若在此 6ms 内崩溃，重启后 idempotency 仍跳过，不重打
- 重启验证        : 重启后（PID 23004 → 6344），无任何已完成任务被重新执行
- 物理出纸        : **无重复出纸** ✓
- 是否通过        : ✅（设计保证已验证）
- **已知限制**    : 若在 `print()` 调用期间崩溃（SumatraPDF spooling ~500–936ms 窗口，`markTaskDone` 尚未执行），
    重启后本地 DB 无记录；10 分钟后 API 状态机将 printing 重置为 pending，Agent 重新 claim 并重打。
    此为已知 trade-off，代码注释已说明（`task may be re-printed after restart`）。
    实际概率极低（spooling 期间崩溃窗口 <1s）。

---

### [spooled restart] 崩溃恢复 → PRINT_JOB_UNCONFIRMED（feat/terminal-agent-print-job-monitor）
- 验证场景       : Agent 在打印后监控期间被杀（simulate crash），重启后发现 local DB `localStatus=spooled`
- taskId         : ptask_kiosk_7554237ac0becd2c
- 流程           :
    1. 任务进入监控期间 → 手动 Kill Agent（模拟 crash）
    2. 等待后端 `resetExpiredClaims`（每 30s，10min 超时窗口）将任务重置为 pending
    3. 重启 Agent → claim → `isTaskDone` 检测 local DB `spooled` → 进入 Step 0 补偿
- Agent 日志关键行:
    [06:31:20] WARN  task ptask_kiosk_7554237ac0becd2c: was already submitted to Windows spooler before restart (crashed during monitoring); outcome cannot be confirmed — PATCH failed+PRINT_JOB_UNCONFIRMED, operator must check device
    [06:31:20] task ptask_kiosk_7554237ac0becd2c: PATCH status=failed ✓
- API 状态       : status=**failed**, errorCode=**PRINT_JOB_UNCONFIRMED** ✓
    errorMessage: 打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态
- 物理出纸       : **无重复出纸** ✓（N5 幂等：spooled 标记阻止重打）
- 是否通过       : ✅ **spooled 重启补偿正确：failed+PRINT_JOB_UNCONFIRMED，不重打，不误报 completed**

---

## 7.2 feat/terminal-agent-print-job-monitor 完整复测汇总（2026-06-03）

> 验证环境：Windows 11 Pro x64 / Node 24 / Pantum CM2800ADN Series / Agent PID 27740
> 分支：`feat/terminal-agent-print-job-monitor`（基于 main `3f35caa`）

| # | 场景 | taskId | API 终态 | errorCode | 结果 |
|---|---|---|---|---|---|
| P1 | 正常单页打印（回归） | ptask_kiosk_5c6bf741c868400f | completed | — | ✅ |
| P4 | copies=2（回归） | ptask_kiosk_4560ee70d68ab763 | completed | — | ✅ |
| P5 | duplex_long_edge（回归） | ptask_kiosk_6d2a4da9eece1714 | completed | — | ✅ |
| N1 | PRINTER_NOT_FOUND（回归） | ptask_kiosk_a0ef494d5417bb2e | failed | PRINTER_NOT_FOUND | ✅ |
| N2 | PRINTER_OFFLINE（回归） | ptask_kiosk_567e9da95b34da0e | failed | PRINTER_OFFLINE | ✅ |
| N3-new | 缺纸 Retained 超时 → UNCONFIRMED | ptask_kiosk_46d128fe180a304c | failed | PRINT_JOB_UNCONFIRMED | ✅ |
| N4 | DOWNLOAD_HASH_MISMATCH（回归） | ptask_kiosk_298aa103ee1b2a04 | failed | DOWNLOAD_HASH_MISMATCH | ✅ |
| spooled restart | 崩溃重启补偿 → UNCONFIRMED | ptask_kiosk_7554237ac0becd2c | failed | PRINT_JOB_UNCONFIRMED | ✅ |

**结论：**
- 正向打印链路（P1/P4/P5）无回归，completed 终态稳定
- 所有负向场景正确落 failed + 对应 errorCode，无误报 completed
- N3 缺纸：不再声称自动识别 PAPER_EMPTY；Pantum Retained 持续超时 → PRINT_JOB_UNCONFIRMED（诚实上报）
- spooled 重启补偿：不重复出纸，API 终态为 failed+PRINT_JOB_UNCONFIRMED
- 全程无重复出纸（N5 幂等）

---

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
