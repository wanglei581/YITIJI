# Kiosk 扫描页方案 B：体验诚实化设计

> 状态：B1 本地候选已实现（待合并/部署/真机）。  
> 范围：SMB 面板扫描流程的前端诚实化 + 能力门禁贯通；**不做** TWAIN/一点即扫（归后续 Spike C）。  
> 双模型审查：Antigravity（agy.real）`APPROVE_WITH_CHANGES`；Claude 侧独立审查 `APPROVE_WITH_CHANGES`。本规格已吸收其 Critical/Warning 约束。

## 1. 目标

让用户在一体机上能**真实进入**现有 SMB 扫描闭环，并看懂「必须到打印机面板操作」；同时去掉假硬件探测与夸大文案，保证 1080×1920 布局不错位。

## 2. 非目标

- TWAIN / WIA / 网页一点即扫（Spike C）
- 色彩 / DPI / ADF 假参数 UI（方案 D）
- Agent heartbeat 上报 `scanWatchFolder` / ScanInputHealth（Phase B2，默认不做）
- Prisma 新模型、支付/打印主路径、Pantum 云 API
- 新落库「保存」API（本轮只诚实引导登录/跳转）

## 3. 问题事实（已核实）

1. `ScanStartPage` 调用不存在的 `GET /kiosk/device/status` → 真机易恒 `offline`，任务创建被错误挡住。
2. 浏览器测试用假 mock 掩盖了上述断路。
3. `PrintScanHomePage` 消费 `TerminalCapability.scan`，但 `ScanStart` 深链与首页「纸质扫描」不消费。
4. Result「保存到我的文档」只 `navigate`，未登录看不到文件且文案像已存档。
5. 前端 `GUIDE_STEPS` 标题与服务端 `instructions` 按 index 拼接会错配（尤其 `document` 仅 3 条）。
6. 服务中心仍写「PDF / 图片」「PDF / JPG / PNG」，与固定 PDF 不符。

## 4. 状态模型（禁止「扫描仪就绪」）

| 前端态 | 条件 | 用户可见 | 可否点「下一步」 |
|--------|------|----------|------------------|
| `blocked` | 已配置且 `status !== 'available'` | 「扫描能力暂未开放」+ note/标准说明 | 否 |
| `unknown` | 拉取失败且无法判断 | 「能力状态暂不可用，请重试或联系工作人员」 | 否（保守，不 fail-open 成可用） |
| `allowed` | 未配置行（managed 与后端一致）或 `available` | 「可创建扫描任务 · 需在打印机面板操作」 | 是 |

硬约束：

- **禁止**文案：扫描仪就绪 / 忙碌 / 本机检测到扫描仪 / 一点即扫。
- **禁止**用 `printer-status` 冒充扫描健康。
- 前端门禁是体验层；权威仍是 `assertUserTaskAllowed(..., 'scan')`。

## 5. 页面改动

### 5.1 ScanStartPage

- 删除 `fetchScannerStatus` / `/kiosk/device/status` / 30s 硬件轮询 / busy 启发式。
- 接入 `getConfiguredCapabilities()` 的 `scan`，按 §4 渲染。
- `ALT_PATHS`：去掉「需扫描仪就绪」类暗示；保留底栏「改用上传文件打印」；替代列表不必强行可点。
- 流程说明统一为面板 + 本机接收目录语义。

### 5.2 ScanSettingsPage + API instructions

- **单一事实源**：页面只渲染服务端 `instructions[]`（编号 + 全文），废弃本地标题表 zip。
- 更新 `SCAN_TYPE_INSTRUCTIONS`：写清「放纸 → 面板选扫描 → 选扫描到网络/SMB（本机已配置的接收位置）→ 开始 → 回屏等待」。
- **不**下发 UNC/共享路径明文。
- 各 `scanType` 条数可不同；UI 按数组长度动态渲染。

### 5.3 ScanProgressPage

- 文案保持「等待打印机端扫描完成」；不引入假进度百分比。
- 不依赖已删除的 scanner 端点。

### 5.4 ScanResultPage + 入口文案

- 「保存到我的文档」改为诚实语义（例如「前往我的文档」）。
- 已登录：跳转 `/me/documents`，并说明可在该页查看会话关联文件；不假装本按钮执行了新的落库。
- 未登录：引导登录（复用现有登录弹层/路由），并提示临时扫描文件有有效期、离开可能无法找回。
- 同步收敛 Start / serviceGroups 中「保存」夸大措辞。

### 5.5 PrintScanHomePage + 可选首页

- 卡片描述改为生成 PDF（去掉图片夸大）。
- 「本机设备能力」中扫描格式改为 PDF-only。
- 首页 `serviceGroups`「纸质扫描」描述诚实化；能力灰掉为可选（深链仍靠 ScanStart 自门禁）。

## 6. 测试与验证

- 更新 `fusion-w2-scan.spec.ts`：改 stub capabilities，断言诚实态文案；删除 `/kiosk/device/status`。
- 同步清理 `fusion-w2-print.spec.ts`、`fixtures/fusion-w6-api.ts` 中同假端点。
- 门禁：`verify:fusion-w2`、Kiosk typecheck/lint、`test:browser:w2`（scan 相关）、必要时 `verify:scan-tasks`（若改 instructions）。
- UI：1080×1920 无横向溢出；触控目标 ≥48px；不重做视觉系统。

## 7. 文件预算

必改：

- `apps/kiosk/src/pages/scan/ScanStartPage.tsx`
- `apps/kiosk/src/pages/scan/ScanSettingsPage.tsx`
- `apps/kiosk/src/pages/scan/ScanResultPage.tsx`
- `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`
- `services/api/src/scan-tasks/scan-tasks.service.ts`（仅 instructions 文案）
- `apps/kiosk/tests/visual/fusion-w2-scan.spec.ts`
- `apps/kiosk/tests/visual/fusion-w2-print.spec.ts`
- `apps/kiosk/tests/visual/fixtures/fusion-w6-api.ts`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

强烈建议：

- `apps/kiosk/src/pages/home/serviceGroups.ts`
- `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs`（若静态断言仍锁「扫描仪就绪」）
- 必要时 `ScanProgressPage.tsx` 文案微调（不大改结构）

禁止：Agent heartbeat、Prisma、支付/打印主路径、TWAIN、假参数 UI。

## 8. 后续 Spike C（本轮只记不写）

网页选参 → Agent/TWAIN 自动开扫 → 尽量不再碰打印机小屏。需独立 Windows 真机 Spike 与验收，不得混入本轮。
