# 首期真实扫描（纸质转电子）设计

> 状态：设计稿。本文只定义"首期真实扫描"的代码范围与验收口径，不代表功能已实现、已合并或已部署。

## 目标

打通"用户在 Kiosk 上发起扫描 → 走到奔图一体机操作面板完成物理扫描 → 电子文件自动进入我们系统 → 用户在 Kiosk 上选择打印/存入我的文档/AI 简历识别"这条此前完全是前端演示的链路，让它变成真实可用的功能。

首页/服务中心的入口不变（见"现状依据"），本轮只把入口背后的假流程换成真流程。

## 非目标

- 不做"发送到用户自己邮箱/U盘"的原生扫描分发（已与用户确认：扫描结果只进我们自己的系统）。
- 不做 TWAIN/WIA 驱动直接触发扫描（已与用户确认：走 SMB 共享文件夹监听方案）。
- 不做多格式输出（已与用户确认：固定 PDF；未来如需图片格式，归入独立的"格式转换"功能，不在本轮扩展）。
- 不新增首页或服务中心入口（复用现有"纸质扫描"/"材料扫描"卡片）。
- 不做 U 盘导入、证件照抠图、格式转换——这些是独立的、仍未开工的功能，不在本轮范围内混做。
- 不做多终端/多打印机共享同一 SMB 目录的并发隔离（当前部署是单终端 + 单打印机，"匹配最早一个等待中的任务"足够可靠；未来如有多终端共享同一打印机的部署形态，需要重新设计匹配机制）。
- 不在这一轮做 Windows 真机联调验收——代码交付后再排到 Windows 真机验收清单里，与其余"Windows 那边"待办同批处理。

## 现状依据

代码库里已经存在，本轮直接复用，不重建：

- **Kiosk 入口**：`apps/kiosk/src/pages/home/HomePage.tsx` 的"打印扫描"分组里"纸质扫描"卡片，以及 `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx` 的"材料扫描"能力卡片，均已指向 `/scan/start`，且都标记 `available: true`。`PrintScanHomePage` 当前对这张卡片有一句诚实的 `note`："流程演示，真机扫描需连接 Terminal Agent"——本轮完成后应删除这句提示。
- **Kiosk 扫描三页**（均为纯前端演示，无真实调用）：
  - `ScanStartPage.tsx`：选扫描类型（简历/证件/文档），`API_MODE==='http'` 时整体禁用并提示"真机扫描待接入"。
  - `ScanSettingsPage.tsx`：来源（平板/ADF）、页数模式、色彩、DPI 四组开关 + 固定显示"PDF"的输出格式说明；`scanUnavailable` 时禁用。
  - `ScanResultPage.tsx`：`useSimulatedScan` 走假进度；结果页已经有"直接打印/保存文档/AI 简历识别/返回首页"四个动作，`API_MODE==='http'` 时前三个动作全部禁用（"2B 安全收口：扫描硬件未接入，http 模式无真实文件，禁止假文件进打印链路"）。这几个动作的目标页（`/print/confirm`、`/profile`、`/resume/parse`）都已存在，本轮只需要传真实文件数据进去。
- **FilePurpose 已有匹配值**：`resume_scan`、`id_scan`、`print_doc` 三个用途在 `packages/shared/src/types/file.ts` 和 `services/api/src/files/file.types.ts` 中均已存在，且 `file-validation.ts` 的 MIME 白名单（`PDF_DOC_IMG`/`PRINTABLE`）都包含 PDF——本轮扫描类型直接复用这三个值，不新增 `FilePurpose`。
- **签名 URL 机制**：`services/api/src/files/signing.ts` 的 `signFileUrl(fileId, ttlMs)` 已经是本轮"手机扫码上传"功能验证过的模式（30 分钟 TTL，供 `PrintJobsService.create()` 校验），本轮扫描结果同样复用这一套，不新建签名机制。
- **短期会话 + 自动过期模式**：`UploadSessionsService` 的 10 分钟 TTL、过期自动清理已上传文件（`cleanupAbandonedFile`）是本轮 `ScanTask` 过期处理的直接参照。
- **CLAUDE.md 硬件约束**：奔图 CM2800/CM2820 系列原生支持"扫描到 SMB/FTP"；不支持云端远程发起扫描；该机型无 WiFi，只有 USB/有线网络。
- **完全空白，需要新建**：`ScanTask` 数据模型（Prisma 无此表）；Terminal Agent 无任何 scan/twain/wia 相关代码；后端无扫描会话相关路由。

## 推荐方案（已与用户确认）

三个关键决策：

1. **扫描目的地** = 我们自己的系统（不是用户自己的邮箱/U盘）。
2. **接入机制** = SMB 共享文件夹监听。奔图打印机原生支持"扫描到网络共享目录"，Terminal Agent 持续监听该目录，新文件出现即视为一次扫描完成。
3. **参数与格式** = Kiosk 只保留"扫描类型"选择（影响下游用途和留存策略）；来源/页数/色彩/DPI 四项从"可调参数"改为"操作指引文案"，因为 Kiosk 触屏无法把这些参数下发给打印机硬件；输出格式固定为 PDF（打印机侧一次性配置好扫描到 SMB 目录时的输出格式，Agent 不做任何格式转换）。

### 数据流

```
Kiosk                          后端 API                         Terminal Agent                 奔图打印机
  │ 选扫描类型                      │                                 │                             │
  │──POST /scan/sessions─────────>│ 创建 ScanTask(status=waiting)   │                             │
  │<──scanTaskId + expiresAt──────│                                 │                             │
  │ 展示操作指引 + 开始轮询           │                                 │ 持续 watch 共享目录            │
  │──GET .../status (每 2s)──────>│                                 │<────────────────────────────│ 用户在打印机面板
  │                                │                                 │  (新文件 add 事件,防抖后)      │  放纸→选参数→按扫描
  │                                │<─POST .../scan-sessions/deliver─│  →写入共享目录
  │                                │  (匹配最早 waiting 任务,建         │
  │                                │   FileObject,标记 completed)     │
  │                                │──成功后 Agent 删除源文件─────────>│
  │<──completed + fileId/fileUrl──│                                 │
  │ 展示结果页,可打印/存档/AI识别      │                                 │                             │
```

## 数据模型

新增 Prisma 模型 `ScanTask`（additive，SQLite/PostgreSQL 双迁移）：

```prisma
model ScanTask {
  id            String    @id @default(cuid())
  terminalId    String
  scanType      String    // 'resume' | 'id' | 'document'
  status        String    @default("waiting")
  // waiting -> matched -> completed
  //         -> expired（超时未匹配）
  //         -> cancelled（用户主动取消）
  //         -> failed（匹配后上传/建档失败）
  endUserId     String?
  fileId        String?
  matchedFileMtime DateTime?
  errorCode     String?
  errorMessage  String?
  expiresAt     DateTime
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([terminalId, status, createdAt])
}
```

- `expiresAt` = `createdAt + 10 分钟`（与 `UploadSessionsService` 的 `SESSION_TTL_SECONDS` 惯例一致）。
- 索引按 `(terminalId, status, createdAt)` 支持"某终端最早一个 waiting 任务"的查询。

## 后端设计

新增模块 `services/api/src/scan-tasks/`（参照 `upload-sessions` 模块结构）：

- `POST /scan/sessions`（Kiosk 调用，可选会员鉴权同 `resolveOptionalEndUser` 模式）
  - 入参：`{ scanType: 'resume'|'id'|'document', terminalId }`
  - 校验 `terminalId` 对应真实、启用的 `Terminal`（复用 `PrintJobsService.create()` 里已有的终端校验逻辑风格）。
  - 建 `ScanTask(status='waiting')`，返回 `{ scanTaskId, expiresAt, instructions }`（`instructions` 为按 `scanType` 定制的操作指引文案，后端下发而不是前端硬编码，方便后续调整文案不用发版）。
- `GET /scan/sessions/:id`（Kiosk 轮询，需要与创建时一致的鉴权/归属校验）
  - 到期未匹配时惰性转 `expired`（同 `UploadSessionsService.getStatus` 的 `markExpired` 模式）。
  - `completed` 时返回 `fileId` + 复用 `signFileUrl()` 现场签发的 30 分钟内容 URL（不持久化签名 URL，每次查询按需签，避免过期链接问题）。
- `DELETE /scan/sessions/:id`（Kiosk 取消按钮）。
- `POST /terminals/:id/scan-sessions/deliver`（**仅 Agent 调用**，走已有的 Agent Bearer token 鉴权，同 heartbeat/claim 端点）
  - multipart 上传扫描文件 + 文件 `mtime`/`size` 元数据。
  - 事务内：查该 `terminalId` 下最早一条 `status='waiting' AND expiresAt > now()` 的 `ScanTask`；若无匹配，返回 `409 NO_WAITING_SCAN_TASK`（Agent 据此把文件移入 `_unclaimed`，不重试上传）。
  - 命中后，按 `scanType` 映射到 `FilePurpose`（`resume`→`resume_scan`、`id`→`id_scan`、`document`→`print_doc`），调用现有 `FilesService.upload()`（`endUserId` 取自 `ScanTask.endUserId`，与 `resume_scan`/`id_scan` 现有留存策略一致：证件扫描默认短期，简历扫描登录用户默认 90 天）。
  - 标记 `ScanTask` 为 `completed`，回填 `fileId`；返回给 Agent 确认，Agent 收到 2xx 后删除共享目录里的源文件。
  - 幂等考虑：Agent 侧理论上每个物理文件只应触发一次投递（chokidar `add` 事件 + 防抖后即视为终态），但为防重试导致重复建档，仍以 `ScanTask.status` 做 CAS（已是 `completed` 的任务不能被二次匹配)。

## Terminal Agent 设计

新增 `apps/terminal-agent/src/agent/scan-watcher.ts`：

- 依赖 `chokidar`（新增到 `apps/terminal-agent/package.json`，仓库内其他包已有该依赖，是成熟稳定的文件监听库）。
- `AgentConfig` 新增可选字段 `scanWatchFolder?: string`（本地路径或映射后的盘符路径，指向奔图打印机"扫描到网络共享"配置的目标目录；显式配置，不给默认值——未配置则本模块整体不启动，不影响现有 Agent 行为）。
- 监听逻辑：
  - `chokidar.watch(scanWatchFolder, { ignoreInitial: true })` 监听新增文件。
  - **防抖/稳定性检查**：文件 `add` 事件触发后，轮询文件大小直到连续两次读取一致（间隔 500ms，超时 10 次判定异常），避免打印机还没写完就被读取到半截文件。
  - 稳定后整体读取文件内容，`POST /terminals/:id/scan-sessions/deliver`（复用 Agent 现有 `api-client.ts` 鉴权客户端）。
  - 成功（2xx）→ 删除共享目录里的源文件。
  - 失败 `409 NO_WAITING_SCAN_TASK` → 将文件移动到 `<scanWatchFolder>/_unclaimed/`（若目录不存在则创建），记录警告日志，不重试、不删除（留痕供人工排查，不静默丢失用户的物理扫描件）。
  - 其它网络/5xx 错误 → 按现有 Agent 惯例记录 warn，文件留在原目录不删除，交由下方的**周期性清点**重试（不依赖 chokidar 的 `change` 事件——一个已经写完、内容不再变化的文件不会再触发 `change`，所以重试必须靠主动扫描，不能被动等事件）。
- **文件夹清点**（启动时 + 之后每 5 分钟一次，与心跳节奏量级一致）：对 `scanWatchFolder` 做一次目录列举，把"当前存在、不在 `_unclaimed` 子目录里"的文件当作候选，走与 `add` 事件相同的稳定性检查 + 投递流程。启动时的一次是为了解决"Agent 重启期间到达的文件被 `ignoreInitial: true` 跳过"；之后每 5 分钟的周期性清点是为了让"投递失败但文件本身没再变化"的文件也能被重新尝试，而不用等到下次 Agent 重启。
- 与现有 Agent 生命周期整合：`src/index.ts` 的 `agent` 命令里，若 `config.scanWatchFolder` 已配置则启动该监听器（与心跳、claim 轮询并行运行，互不阻塞）；未配置则记录一行 info 日志"扫描监听未配置，跳过"，不报错、不影响其余功能。

## Kiosk 前端设计

- `ScanStartPage.tsx`：整体流程不变，去掉 `API_MODE==='http'` 时的整体禁用（真实实现后 http 模式应该可用）。
  **已知限制（本轮不解决）**：本设计没有让后端感知"这台终端的 Agent 是否真的配置了 `scanWatchFolder`"的机制——`scanWatchFolder` 只是 Agent 本地配置，后端并不知道。如果 Agent 未配置或未运行，用户发起扫描后不会有针对性的"扫描未配置"提示，而是等 10 分钟后按正常超时提示"扫描超时，请重试或联系工作人员"。这是可接受的 v1 简化（不引入 Admin 可配置的终端能力字段，避免与尚未做的 FeatureGate/DeviceCapability 系统混在一起动工）；如果后续需要更精确的"未配置"提示，需要另外设计终端能力上报机制。
- `ScanSettingsPage.tsx`：删除来源/页数模式/色彩/DPI 四个 `ToggleGroup`，改为展示后端下发的 `instructions`（图文操作指引卡片，按扫描类型有差异化文案）；确认按钮文案改为"我已在打印机上操作，开始等待"，点击后调用 `POST /scan/sessions` 建任务并跳转 `/scan/progress`。
- `ScanProgressPage.tsx`（当前应为纯演示态，本次一并接真）：轮询 `GET /scan/sessions/:id`（2 秒间隔，同 `UploadSessionQrPanel` 的轮询节奏），根据状态展示"等待打印机端扫描完成…"/成功跳 `/scan/result`/`expired` 或 `failed` 时展示对应重试或返回首页选项；提供"取消"按钮调用 `DELETE`。
- `ScanResultPage.tsx`：`file` 状态从"演示假数据"改为真实 `{fileId, fileUrl, mimeType,...}`；`handlePrint`/`handleSave`/`handleResumeAI` 的 `disabled={API_MODE === 'http'}` 判断去掉（改判"是否有真实 `file`"），复用现有下游页面（`/print/confirm`、`/profile` 或 `/me/documents`、`/resume/parse`）不变。
- `PrintScanHomePage.tsx`："材料扫描"卡片删除 `note: '流程演示，真机扫描需连接 Terminal Agent'`。

## 安全与隐私

- 共享目录里的文件生命周期极短：投递成功即删除源文件；未匹配文件移入 `_unclaimed` 由管理员人工核查清理（后续可选补一个 Admin 侧只读查看入口，本轮先靠日志+目录本身，不在本轮强制要求）。
- 证件扫描（`id_scan`）复用已有的短期留存策略，不因为走了新链路而绕过既有的敏感文件保留规则。
- `_unclaimed` 隔离的意义：宁可让一个扫描件暂时"没人认领"进入人工可查的隔离区，也不允许把它错误地上传/关联到不相关的用户会话——这是本设计里唯一的"宁可失败也不误判"的安全边界。
- Agent→后端的投递端点复用现有 Agent Bearer token 鉴权，不新开无认证端点。

## 验证计划

- 后端新增 `verify:scan-sessions`：覆盖任务创建、过期转换、`deliver` 端点匹配最早 waiting 任务、无匹配时返回 `409` 且不建档、`scanType`→`FilePurpose` 映射正确、签名 URL 现场签发。
- Terminal Agent 新增单元验证：文件稳定性防抖逻辑、`_unclaimed` 移动逻辑、启动时 + 周期性文件夹清点逻辑（用临时目录 + 假文件模拟，不需要真实打印机）。
- Kiosk：`typecheck`/`lint`；`ScanSettingsPage`/`ScanProgressPage`/`ScanResultPage` 浏览器走查（mock 模式下可用固定假数据模拟状态流转，验证 UI 分支覆盖）。
- **Windows 真机验收**（不在本轮代码交付范围，完成代码后排入 Windows 真机待办清单）：在奔图打印机上真实配置"扫描到 SMB"指向 Agent 监听目录；用真实纸质文件走完整链路，确认文件正确落到 Kiosk 结果页；验证 Agent 重启后遗留文件的历史清点；验证"未开等待任务时手动扫一份文件"能正确进 `_unclaimed` 而不是被错误认领。

## 上线前提（非代码，运维配置）

打印机的"扫描到 SMB"功能需要在设备管理界面/控制面板上配置一次：目标共享路径、访问账号、以及（如支持）固定输出格式为 PDF。这是一次性硬件配置动作，由现场人员完成，不属于本轮代码交付内容，但会写进 Windows 真机验收清单作为前置步骤。
