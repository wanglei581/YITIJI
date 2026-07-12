# 证件照打印（前端规格裁剪 + A4 排版 PDF + 彩色打印）设计文档

> 日期：2026-07-12
> 关联文档：[user-data-flow-matrix.md §3.4](../../product/user-data-flow-matrix.md) | [next-tasks.md](../../progress/next-tasks.md)（"首期证件复印与证件照"条目） | [compliance-boundary.md §五](../../compliance/compliance-boundary.md) | [file-retention-and-cos-lifecycle.md](../../compliance/file-retention-and-cos-lifecycle.md) | [2026-07-11-format-conversion-design.md](./2026-07-11-format-conversion-design.md)（同模式先例）
> 状态：brainstorm 阶段设计，未开始实现。已经外部 Codex（architect 角色）只读评审一轮（Session `019f563e-2858-78f1-b8ba-77b4a09d05cb`），其 3 个 P0 阻断项与全部 P1/遗漏点已在本版吸收（见 §十二 评审吸收记录）。

## 〇、用户已拍板的三个方向（2026-07-12）

1. **MVP 不做自动抠图/换底色**：首期只做规格裁剪 + 排版 PDF + 彩色打印，页面如实提示"请上传纯色底（白/蓝/红）的标准证件照片"。抠图换底列为二期，届时按第三方云 API 路线单独做隐私评审（人脸照片出内网必须明示告知 + 用户同意 + 单独评审，不得静默混入本期）。`next-tasks.md` 中"抠图、换底色"要求改为分阶段交付。
2. **只做 A4 排版 + 修正文案**：Pantum CM2800 是彩色激光机，普通喷墨相纸不能进激光机（会损坏定影器），输出质量达不到照相馆冲印水平。现有占位说明页"自动排版到 6 寸相纸 / A4"的承诺必须修正为仅 A4；页面诚实说明"彩色激光打印效果，适合临时应急使用，非照相馆冲印质量"。
3. **规格检测只做尺寸/比例/分辨率检测**：不做人脸位置检测（无外部依赖、无误判风险）；裁剪构图由用户在预览中自行确认。

## 一、背景与范围

Kiosk 首页「打印扫描」分组的"证件照打印"磁贴目前 disabled（`HomePage.tsx`），`/print-scan/feature/id-photo` 是 MVP 说明页占位。`id_photo` 能力键已存在于 `TerminalCapability` 体系（`terminal-capabilities.types.ts`、`PrintScanHomePage.tsx` 的 `CARD_CAPABILITY_KEY`）。

**MVP 范围（明确边界）**：

- ✅ 选择规格 → 上传一张标准证件照片（JPEG/PNG）→ **Kiosk 浏览器内**检测 + 按规格居中裁剪 + 预览确认 → 上传裁剪产物 → 服务端生成 A4 整版排版 PDF（带裁切线）→ 进入既有 `/print/confirm` 彩色打印
- ❌ 自动抠图/换底色（二期，云 API 路线 + 独立隐私评审）
- ❌ 人脸位置/质量检测（与抠图同期评估）
- ❌ 6 寸相纸排版（激光机相纸进纸与定影效果未验证；如未来做，须先采购激光专用相纸并真机验证）
- ❌ 摄像头现场拍摄（硬件采集链路未建成，属"依赖硬件未开工"项）
- ❌ 美颜/修图/服装替换等图像编辑能力
- ❌ 证件照单独定价/套餐（按既有打印计费：A4 彩色页价 × 份数；商业化定价属支付域扩展，另行立项）

**核心架构决策（吸收 Codex P0 评审后确定）：服务端全程零原生图片解码。**

仓库已两次复现：对用户上传的原始图片字节在 API 主进程调用 `@napi-rs/canvas` 原生 `loadImage()` 会 native `SIGSEGV` 整进程崩溃，JS try/catch 防不住，启发式预检可被绕过（`materials.service.ts:491-497` 的 Critical 注释，该模块的对策是彻底跳过此操作）。因此本设计**不在服务端解码任何用户图片**：

- **裁剪缩放在 Kiosk 前端浏览器 canvas 完成**（浏览器沙箱承担不可信字节解码；解码失败/恶意样本最多崩一个 tab，不伤服务）。现代 Chromium 解码时自动应用 EXIF Orientation，canvas 重编码产物无 EXIF、方向恒正 —— 一并消除了服务端 EXIF 处理问题。
- 服务端只接收**裁剪产物**（canvas `toBlob('image/jpeg')` 输出），用纯 JS 的 `image-dimensions.util.ts` 做魔数 + 尺寸硬校验（必须精确等于规格目标像素），再由 `pdfkit`（纯 JS 解析嵌入，格式转换已在生产使用的同一安全面）排版。
- `@napi-rs/canvas` 完全退出本设计。若二期抠图需要服务端图像处理，届时按 child_process 进程隔离方案另行设计（部署打包/超时/内存上限/崩溃回收/恶意样本验证一并定义）。

附带隐私红利：**本机上传路径的原图根本不上传服务端**——浏览器本地读取、本地裁剪，只有裁剪产物离开浏览器。

**其余技术底座（全部已在仓库核实，零新增运行时依赖）**：

- `pdfkit`（格式转换在用）→ A4 排版 PDF
- `image-dimensions.util.ts`（格式转换新增的零依赖 JPEG/PNG 魔数+尺寸解析，纯 JS）→ 裁剪产物硬校验
- `id_scan` FilePurpose（既有）：IMG 白名单、10MB 上限、`highly_sensitive`（默认 TTL 1 小时）、保存策略强制 `system_short` 且代码级禁止延长（`RETENTION_ID_SCAN_LOCKED`），会员绑定也不改变短期策略（`retention-policy.ts:52`）
- `FilesCleanupTask`（既有）：每小时 cron 物理删除过期文件并落审计

## 二、用户流程

1. 首页"证件照打印"磁贴 / `/print-scan` 服务中心"证件照"卡片 → 新页面 `/print-scan/id-photo`（替换现有 `PrintScanFeatureInfoPage` 的 `id-photo` 说明页视图；说明页保留给 `sign`）。
2. 页面顶部：隐私说明 + 输出质量诚实说明（见 §九）。
3. 选择规格（一寸 / 小一寸 / 二寸 / 小二寸，56px+ 大按钮）。
4. 获取照片，两种来源：
   - **本机上传**：单文件 `<input type="file">`（沿用 A2 桌面验证定位）。**原图不上传服务端**，浏览器 `createImageBitmap` 本地解码。
   - **手机扫码上传**：复用 `UploadSessionQrPanel`（`purpose="id_scan"`，服务端与 H5 页需扩展，见 §四.7）。原图落服务端（`id_scan`，1 小时 TTL）；Kiosk 经 `fileAccessUrl` fetch 原图字节到浏览器解码。
5. 前端检测 + 裁剪（全部浏览器内完成）：
   - 按目标规格宽高比计算 cover 裁剪区域，校验 `cropWidth ≥ targetWidth && cropHeight ≥ targetHeight`（不足 → 拒绝并提示"照片分辨率不足，打印会模糊"）；低于 2 倍目标像素 → 警告"可能不够清晰"但可继续。
   - 宽高比偏差大时提示裁剪损失；居中裁剪结果实时预览，用户确认构图（不满意换照片）。
   - canvas 裁剪缩放到目标像素，`toBlob('image/jpeg', ~0.92)` 生成裁剪产物。
   - 解码失败（损坏/超大图）→ 诚实报错；`URL.createObjectURL` 及时 revoke；离开页面清理本地对象与已上传文件（best-effort）。
6. 裁剪产物经既有 kiosk 上传通道上传（`purpose='id_scan'`，走 `file.upload` 既有审计）；扫码路径此时**前端即调删除原图**（best-effort，TTL 兜底）。
7. 点击「生成排版」→ `POST /print/id-photo/layout`（裁剪产物 fileId）→ 服务端硬校验 + pdfkit 排版 → 返回排版 PDF → 跳转 `/print/confirm`。**不经过** `PrintMaterialCheckPage` 隐私检查步骤（该步骤的 PII 扫描可能调用第三方 OCR；与格式转换直跳 `/print/confirm` 同先例）。
8. 打印任务创建成功后：**服务端**（非前端）自动物理删除裁剪产物（见 §四.9）；排版 PDF 按 1 小时 TTL 由 cron 物理删除。页面另提供「立即删除照片」手动按钮。
9. 扫码上传期间接入 `useBusyLock`，防止待机屏打断。

## 三、规格体系

规格常量表放 `packages/shared`（`packages/shared/src/index.ts` 导出；`services/api` 因 CJS/ESM 限制按既有约定建本地镜像，SSOT 指向 shared）：

| specId | 名称 | 物理尺寸 | 300dpi 像素（裁剪产物必须精确等于此值） |
|---|---|---|---|
| `one_inch` | 一寸 | 25×35mm | 295×413 |
| `small_one_inch` | 小一寸 | 22×32mm | 260×378 |
| `two_inch` | 二寸 | 35×49mm | 413×579 |
| `small_two_inch` | 小二寸 | 35×45mm | 413×531 |

- 表结构可扩展（大一寸/大二寸等后续按需增行，不改引擎）。
- 页面规格说明附注："各类考试、签证、证件受理机构对照片可能有特殊要求（底色、着装、采集方式等），请以受理机构要求为准"——避免"符合官方要求"的过度承诺。

**A4 整版排版规则**：

- A4 210×297mm；四周页边距 10mm；格间距 4mm；网格居中；每格四角画浅灰裁切线。
- 行列数由规格尺寸自动计算：`cols = floor((210-20+4)/(w+4))`，`rows = floor((297-20+4)/(h+4))`。示例：一寸约 6×7=42 张/版、二寸约 4×5=20 张/版（以实现为准）。
- MVP 只做"整版排满"一种模式：同一张 A4 彩色页价出整版照片，是对用户最便宜的诚实选择；需要更多份直接加打印份数。
- 页脚小字：规格名称 + 生成日期 +"彩色激光打印"。
- pdfkit 多次 `doc.image()` 嵌入同一 Buffer：实现第一步先 spike 实测 pdfkit 是否复用图像对象；若每格重复嵌入导致体积膨胀（42 格 × 单张体积），改为手动注册单个 XObject 复用或降低嵌入质量，落地前必须实测输出体积 ≤15MB。

## 四、后端设计

### 4.1 新模块

新增 `services/api/src/id-photo/`（参照 `print-conversion` 模块组织）：

- `id-photo.controller.ts` — `POST /print/id-photo/layout`、`DELETE /print/id-photo/file/:fileId`
- `id-photo.service.ts` — 校验、排版、落库、删除
- `id-photo.types.ts` — 本地类型镜像（SSOT 指向 `packages/shared/src/types/idPhoto.ts`）
- `dto/` — 请求 DTO
- 集成点：`app.module.ts` 注册 `IdPhotoModule`；Kiosk `routes/index.tsx` 注册 `/print-scan/id-photo`；`packages/shared/src/index.ts` 导出 idPhoto 类型与规格常量；`services/api/package.json` + 根 scripts + 双 CI job 注册 `verify:id-photo`。

### 4.2 请求契约

```text
POST /print/id-photo/layout
Headers:
  Authorization: Bearer <member token>   # 可选；游客可用
  Idempotency-Key: <前端首次点击生成时创建>

Body:
{
  source: { fileId: string, fileAccessUrl: string },  # 裁剪产物；fileAccessUrl = 既有 HMAC /files/:id/content?expires&sig
  specId: 'one_inch' | 'small_one_inch' | 'two_inch' | 'small_two_inch',
  terminalId: string
}
```

`fileAccessUrl` 只作为授权凭证校验（签名、有效期、其中 fileId 与请求一致），实际读取永远走数据库 `storageKey + bucket`——完整沿用格式转换经 Codex 评审确认的防 SSRF / 防文件 ID 探测模式（`print-conversion.service.ts:169,209`）。

响应：

```text
{
  fileId, printFileUrl(signFileUrl 30 分钟内部 HMAC，非 COS 预签名),
  fileMd5: 输出 FileObject.sha256, pages: 1,
  specId, layoutCount: 每版张数,
  sourceDeleteToken?: <游客场景的删除 action token，见 §4.9>
}
```

### 4.3 归属校验

与格式转换 §3.3 同一套（会员按 `endUserId`/`ownerType='user'` 精确匹配；游客校验 HMAC capability URL 且记录须为 `endUserId=null, ownerType='system'`），差异仅两点：

- `purpose = 'id_scan'`（不是 `print_doc`）
- `mimeType IN ('image/jpeg','image/png')`（裁剪产物实际恒为 JPEG，容忍 PNG）

任一条件不满足统一返回 404 `IDPHOTO_SOURCE_NOT_FOUND`，不区分"不存在/他人文件"。幂等命中缓存时同样重新执行**归属校验 + 终端能力门禁**（后者防止"允许终端生成的缓存结果被另一个未验收终端复用"）。

### 4.4 服务端硬校验（对裁剪产物）

- 魔数与数据库 `mimeType` 一致（`image-dimensions.util.ts`，纯 JS）。
- 解析像素宽高：**必须精确等于 specId 对应的 300dpi 目标像素**，否则 `IDPHOTO_DIMENSIONS_MISMATCH`。规格判断由服务端锚定，前端裁剪只是产出手段——绕过前端直接上传恰好等于目标像素的图片是允许的（用户自己的照片、自己付费打印，无安全增量）。
- 单张 ≤ 10MB（`id_scan` policy 既有上限）。目标像素最大 413×579 ≈ 0.24MP，无需 25MP 类上限。
- 分辨率充足性检测（≥1×/≥2× 目标）发生在前端对原图（§二.5）；服务端不接触原图。

### 4.5 排版

- `pdfkit` 按 §三规则生成单页 A4 PDF（嵌入体积问题见 §三末条 spike 要求）。
- 一次性在内存生成完整 PDF 后再落库；任一环节失败整体失败，不产出半成品。
- 生成后 `countPdfPages()` 校验输出恰好 1 页。
- **审计强一致**：`id_photo.layout_generated` 审计写入失败时，删除刚生成的输出文件并返回 `IDPHOTO_FAILED`——高敏文件不允许"生成成功但无审计"的静默状态（区别于 `AuditService.write` 默认 fail-open 语义，本端点显式检查写入结果）。

### 4.6 输出与落库：新增 FilePurpose `id_photo_print`

排版 PDF 含人脸照片，**不能**落 `print_doc`（`normal` 敏感级、24h TTL、会员可延长保存）。格式转换当时坚持"不新增 FilePurpose"，本功能因隐私档位不同而必须新增：

```text
purpose        = 'id_photo_print'（新增）
assetCategory  = 'derived'
sourceFileId   = 裁剪产物 fileId（单输入，血缘明确）
```

新 purpose 的完整改动清单（实现阶段逐项落，缺一即隐私档位漏洞；`PURPOSE_FOLDER` 等 `Record<FilePurpose,...>` 映射漏项会直接类型报错兜底）：

| 位置 | 改动 |
|---|---|
| `packages/shared/src/types/file.ts` + `services/api/src/files/file.types.ts` | FilePurpose union 增加（shared 为 SSOT） |
| `file-validation.ts` `PURPOSE_POLICY` | `{ mimes: ['application/pdf'], maxBytes: 20MB }` |
| `file-validation.ts` `DEFAULT_SENSITIVE_BY_PURPOSE` | `highly_sensitive`（→ 默认 TTL 1 小时） |
| `retention-policy.ts` `allowedPoliciesForFile` | 返回 `['system_short']`（与 `id_scan` 同等锁定） |
| `retention-policy.ts` `assertCanSetRetention` | 增加与 `RETENTION_ID_SCAN_LOCKED` 同等的拒绝分支 |
| `object-key.ts` `PURPOSE_FOLDER` | `{ scope: 'user', folder: 'id-photos' }`（游客无 ownerId 自动退 `tmp/`，既有行为） |
| 各上传 DTO 白名单（`create-upload-intent` / `upload-options` / `kiosk-upload-options`） | **不加入**——该 purpose 仅服务端生成物使用，用户不可直接上传 |
| `apps/admin/src/routes/files/fileMeta.ts` | 增加 purpose 标签行（如「证件照排版」），否则 Admin 文件管理显示未知类型 |
| `apps/admin/src/services/api/files.ts` | purpose union 镜像同步 |
| `apps/kiosk/src/services/api/filesMockAdapter.ts` | 敏感级 mock 映射增加 `highly_sensitive` |
| `materials.service.ts` 材料任务入口 | 按可信 `FileObject.purpose` 显式拒绝 `id_photo_print` / `id_scan` 进入 `pii_scan` 等会调外部 OCR 的路径（见 §五 OCR 隔离；不依赖当前零引用的 `HIGH_RISK_PII_PURPOSES` 常量） |

### 4.7 扫码上传扩展

扩 `id_scan` 进扫码上传会话**不止改服务层集合一处**（已逐处核实）：

| 位置 | 改动 |
|---|---|
| `upload-sessions.service.ts` `SUPPORTED_UPLOAD_SESSION_PURPOSES` | 增加 `id_scan` |
| `upload-sessions.dto.ts` `@IsIn(['resume_upload','print_doc'])` | 增加 `'id_scan'` |
| `upload-sessions.service.ts` `confirm()` | 当前只有 `print_doc` 分支生成 `fileUrl`（`:234`）；`id_scan` 必须增加同类返回分支（Kiosk 需要 `fileAccessUrl` fetch 原图）；会员 confirm 重绑 owner 后 `id_scan` 仍保持短期策略（`:300`，既有行为，验证覆盖） |
| `upload-sessions.service.ts` 构造器 | **注入 `AuditService`**：该服务当前无任何审计（只注入 Redis/Prisma/FilesService），手机扫码上传路径没有 `file.upload` 审计——`id_scan` 会话 confirm 必须补写上传审计（其他 purpose 顺带补全属低风险改进，实现时定夺） |
| `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx` | 现有逻辑把 purpose 二值化（`isPrintDoc` 布尔 + 二选一 accept）；`id_scan` 若不处理会被错误显示成"简历"并放开 PDF/DOCX/WEBP。需增加 `id_scan` 分支：`accept` 仅 `image/jpeg,image/png`、证件照专属文案（含隐私说明） |
| `UploadSessionQrPanel.tsx` 会员徽标 | 会员模式固定显示"会员文件确认后归档"（`:241`），与证件照强制短期保存冲突；需按 purpose 显示"证件照短期保存，1 小时内自动删除" |
| shared `UploadSessionFileView.fileUrl` / Kiosk `PhoneUploadedFile.fileUrl` 注释 | "仅 print_doc" 的注释扩展到 `id_scan` |

### 4.8 能力门禁与上线开关

- 服务端：layout 端点执行 `assertUserTaskAllowed(terminalId, 'id_photo')`（能力键已存在）。已核实真实语义：未配置行由 `PRINT_SCAN_CAPABILITY_MODE` 决定——`managed`（兼容模式）放行、`strict`（生产门禁要求）fail-closed 拒绝；DB 脏值归 `not_verified` 不放大可用。通用打印建单只校验 `document_print`，因此 `id_photo` 门禁必须且只能在排版接口独立执行（已按此设计）。
- 体验层：`/print-scan` 卡片与首页磁贴**默认保持 available:false / disabled**，路由与页面代码合入但不点亮；待 Windows 真机彩色验收（§六）通过后，由 Admin 在「打印扫描运维 → 设备能力」把 `id_photo` 置 `available`，卡片经既有 `getConfiguredCapabilities` 覆盖机制点亮。上线节奏与验收 gate 天然绑定，不需要发版。
- 流程页自身加载时按能力开关 fail-closed 显示诚实不可用态。

### 4.9 使用后删除（吸收评审：改为服务端可靠动作）

**主删除路径（服务端事件，不依赖前端）**：`PrintJobsService.create()` 建单事务成功后，若任务文件对应 `FileObject.purpose === 'id_photo_print'` 且其 `sourceFileId` 指向存活的 `id_scan` 文件，则服务端 best-effort `systemDelete(sourceFileId, 'id_photo_source_after_print')` 并写 `id_photo.source_deleted` 审计。删除失败只记日志（cron 兜底），不影响打印任务。前端页面关闭/刷新/断网都不影响该路径。

**手动删除端点**：

```text
DELETE /print/id-photo/file/:fileId
  会员：Bearer token → FilesService.ownerDelete()
  游客：请求体携带 sourceDeleteToken（不放 URL query）→ 校验通过后 systemDelete()
```

- 游客删除 token 是**独立 action token**（`aud='id_photo_delete'`、绑定 fileId、服务端 HMAC 签发），**不复用读取用的 `fileAccessUrl`**——读取 capability 不得扩张为破坏性操作授权；token 有效期覆盖文件剩余生命周期（1 小时），弥补 30 分钟读取 URL 过期后无法手动删除的窗口。token 统一由 **layout 响应**下发（`sourceDeleteToken`，§4.2），仅存组件内存，不落 sessionStorage/URL；layout 之前游客侧「删除」仅清除本地引用并由 TTL 兜底（不为此扩改既有上传端点），会员则随时可凭登录态删除。
- **幂等在端点层实现**：已核实 `FilesService._delete` 首行 `requireAlive(fileId)` 对已删除文件会抛错，并非天然幂等；端点先查记录状态，`status='deleted'` 直接返回成功。
- 手动删除同样写审计；审计失败时删除本身不回滚（文件已物理删除即隐私目标达成），但返回体如实标注。

**兜底**：无论以上是否执行，原图（扫码路径）、裁剪产物、排版 PDF 全部 `highly_sensitive` 1 小时 TTL，每小时 cron 物理删除（最迟约 2 小时），删除留审计。本机上传路径原图从未离开浏览器，无需服务端删除。

### 4.10 资源限制、幂等、错误码

| 项目 | 限制 |
|---|---|
| 输入 | 单张 JPEG/PNG 裁剪产物，≤10MB，尺寸精确等于规格目标像素 |
| 频控 | 用户（登录态）/ IP / terminalId 三维分别限流，各 3 次/分钟（实现用既有 Redis 计数模式，不依赖单一 `@Throttle` 装饰器） |
| 单实例并发生成 | Redis `setNxEx` 全局锁 ≤2 并发；排队直接拒绝（`IDPHOTO_BUSY`，前端提示稍后重试）；锁带 TTL 超时自动释放，进程崩溃不留死锁 |
| 输出 PDF | ≤15MB（`PROXY_MAX_BYTES` 同格式转换 MVP 口径） |

幂等：`Idempotency-Key` + Redis `setNxEx`，行为与格式转换 §3.7 一致（同 key 同请求已完成 → 返回已有输出并重签 URL；处理中 → 409；不同请求 → 409 `IDPHOTO_IDEMPOTENCY_KEY_REUSED`；失败释放锁），并做三点强化：

1. fingerprint 包含 `sourceFileId + specId + terminalId + 请求方身份`；
2. completed 缓存 TTL 与输出文件 1 小时 TTL 对齐（格式转换的 10 分钟 TTL 不照搬——那会允许同 key 在 10 分钟后再生成一份高敏 PDF）；命中时校验输出文件未过期/未删除，已失效则清缓存重新生成；
3. 命中缓存返回前重新执行归属校验 + 终端能力门禁（§4.3）。

```text
IDPHOTO_INPUT_INVALID / IDPHOTO_SPEC_UNKNOWN / IDPHOTO_SOURCE_NOT_FOUND
IDPHOTO_SOURCE_TYPE_UNSUPPORTED / IDPHOTO_DIMENSIONS_MISMATCH / IDPHOTO_SOURCE_TOO_LARGE
IDPHOTO_BUSY / IDPHOTO_GENERATION_IN_PROGRESS / IDPHOTO_IDEMPOTENCY_KEY_REUSED / IDPHOTO_FAILED
```

错误响应不含存储路径、COS 正文、签名串或堆栈。

## 五、隐私生命周期（采集 → 使用 → 删除 → 审计）

| 环节 | 机制 | 既有/新增 |
|---|---|---|
| 采集 | 本机路径：原图不出浏览器（无服务端采集面）。扫码路径：`purpose=id_scan` 上传，`highly_sensitive`、TTL 1 小时、策略锁定；裁剪产物同 `id_scan` 经 kiosk 通道上传 | 既有 + §4.7 扩展 |
| 使用 | 裁剪在浏览器沙箱内；服务端仅纯 JS 校验 + pdfkit 排版；**照片全程不出内网、不调用任何第三方服务、不进第三方 OCR** | 新增（本设计） |
| 删除 | 打印建单成功 → 服务端自动删除裁剪产物；扫码原图在裁剪产物上传后由前端即删（best-effort）；手动「立即删除」（会员 token / 游客独立 action token）；1 小时 TTL + 每小时 cron 物理删除兜底（最迟约 2 小时） | 既有 cron + 新增服务端事件删除 |
| 审计 | 本机/裁剪产物上传（kiosk 通道既有 `file.upload`）、扫码上传（**新增**，§4.7 注入 AuditService）、`id_photo.layout_generated`（新增，失败即回滚输出，§4.5）、打印任务创建（既有）、`id_photo.source_deleted`（新增）、cron 清理删除日志（既有）、管理员访问文件日志（既有） | 既有 + 3 个新增点 |

**OCR 显式隔离**：既有材料检查链路（`materials.service.ts` 的 `pii_scan` 等）对任意 purpose 都会执行真实抽取/OCR，且 `HIGH_RISK_PII_PURPOSES` 常量当前零引用、无运行时作用。为杜绝"会员在 1 小时内从「我的文档」把 `id_photo_print` 送进通用材料检查 → 外部 OCR"的路径，实现两道闸：① 材料任务服务端按可信 `FileObject.purpose` 拒绝 `id_photo_print`/`id_scan`（新增校验，不依赖该死常量）；② 「我的文档」对 `id_photo_print` 不提供材料检查入口（见下）。

**「我的文档」中 `id_photo_print` 的操作矩阵（会员，1 小时可见窗口内）**：

| 操作 | 允许？ | 说明 |
|---|---|---|
| 预览 | ✅ | 内部 HMAC 签名 URL |
| 再次打印 | ✅ | 复用既有文档→打印链路；服务端按 purpose 强制证件照参数契约（§六） |
| 修改保存期限 | ❌ | `allowedPoliciesForFile` 锁 `system_short`，前端不显示延长入口 |
| 材料检查 / pii_scan | ❌ | OCR 隔离（上文两道闸） |
| 删除 | ✅ | 既有本人删除 |
| 过期后 | 自动从列表消失（既有 `isVisibleMemberFileWhere`）；打印订单详情如实提示"证件照文件已按隐私策略自动删除，不支持重新打印" | — |

**重印语义更正**（吸收评审）：打印订单引用的是排版 PDF（派生物），删除源照片不影响它；真正使重印不可用的是**输出文件本身过期/删除**。重印入口按输出文件状态判断，过期报既有文件缺失/过期错误码，页面文案不承诺证件照可长期重印。

## 六、与打印链路的衔接（证件照专用参数契约 + 真机验收 gate）

**证件照专用打印参数契约（吸收评审 P0：`scale` 默认 `'fit'` 会让 Agent 按"适合页面"缩放，一寸照将被缩小失去规格意义）**：

```text
makePrintParams({
  color: 'color',
  scale: 'actual',        // Agent 映射为 noscale（print-with-pdf-to-printer.ts:49-50，已核实）
  duplex: 'simplex',
  orientation: 'portrait',
  paperSize: 'A4',
})
copies 由用户在 IdPhotoPage 内选择（1-N）
```

- **参数在 IdPhotoPage 内定死后跳转**。已核实 `/print/confirm` 只展示参数、无编辑控件——草稿版"用户在确认页改黑白时提示"实际不可能发生，已废弃：MVP **不提供黑白选项**（黑白证件照无使用价值），页面固定彩色并如实标注。
- **服务端强校验**：`createPrintJob()` 中若 fileId 对应 `FileObject.purpose='id_photo_print'`，强制校验 params 满足上述契约（`scale='actual'`、`colorMode='color'`、`duplex='simplex'`、`paperSize='A4'`），不符返回 `PRINT_PARAMS_INVALID_FOR_ID_PHOTO`——不信任前端。「我的文档」重印路径同受此校验保护。
- 计费：既有 `quotePrint`（`print_color_page` 彩色页价 × 1 页 × 份数，`pricing.service.ts:55-65` 已核实），零新增计费逻辑。
- 跳转 `/print/confirm` 传参与格式转换实现（`ConvertImagesPage.handleGenerate`）同构：`file{name,size,pages:1,fileId,fileUrl=printFileUrl,fileMd5,mimeType:'application/pdf'}` + 上述 params + `source:'document'`；纯 navigate state 传递（已核实格式转换未写 `printMaterialSession`，该 session 只由材料检查/预览页写入），1 小时 TTL 下刷新丢失代价低，接受。

**时序事实（吸收评审更正——存在两个独立 30 分钟窗口，不是"约 55 分钟"）**：

1. layout 返回的 `printFileUrl` 30 分钟内有效，用于建单；
2. 建单时 `PrintJobsService` 重签 30 分钟 URL 存入 `PrintTask.fileUrl`（`print-jobs.service.ts:229`）；
3. Agent claim 时**原样返回**该 URL，不重签（`terminals.service.ts:740`，已核实）。

因此**建单后超过 30 分钟才被 claim/下载的任务必然失败**（对所有打印任务成立，非证件照特有）；证件照文件 1 小时 TTL 使总窗口进一步受限。MVP 接受：正常 claim 在秒级；超窗任务按既有"文件缺失/URL 过期"路径诚实失败。**"claim 时基于存活 FileObject 重签短 URL（且不超过文件剩余 TTL）"是打印域通用改进，列为独立后续任务，不混入本设计实现。**

**上线 gate（硬前置）**：Terminal Agent 彩色出纸标注"需真机验证"（`apps/terminal-agent/src/printer/types.ts`：SumatraPDF `-print-settings color` 待验）；`scale=actual→noscale` 的实际出纸尺寸同样未上机验证。证件照必须彩打 + 尺寸准确，因此本功能真机验收 = 彩色出纸 + `noscale` 实物量尺（一寸 25×35mm ±1mm）+ 隐私生命周期演练（§十）。验收通过前 Admin 不配置 `id_photo=available`，功能不点亮（§4.8）。

## 七、前端改动范围

- 新页面 `apps/kiosk/src/pages/print-scan/IdPhotoPage.tsx`（`/print-scan/id-photo`，注册进 `routes/index.tsx`）：规格选择 → 双来源取图 → 浏览器内检测/裁剪/预览（原生 canvas，不引入裁剪库）→ 上传裁剪产物 → 份数选择 → 生成排版 → 跳 `/print/confirm`；「立即删除照片」按钮；`useBusyLock` 保护扫码；触控目标 ≥48px、主按钮 ≥56px、竖屏布局。
- 新增 `apps/kiosk/src/services/api/idPhoto.ts`（独立 API 模块，不复用招聘会 `httpAdapter.ts`）。
- `PrintScanFeatureInfoPage.tsx`：删除 `id-photo` key（说明页只留 `sign`；"6 寸相纸"承诺文案随视图删除）。
- `PrintScanHomePage.tsx`：`id-photo` 卡片 `to` 改 `/print-scan/id-photo`，`available` 保持 false 默认（能力开关点亮，§4.8）；描述改"常见规格证件照 A4 排版彩色打印"。
- `HomePage.tsx`："证件照打印"磁贴指向 `/print-scan/id-photo` 并解除 disabled（磁贴无能力开关机制，由流程页 fail-closed 兜底，与"格式转换"磁贴先例一致）。
- `PhoneUploadPage.tsx` + `UploadSessionQrPanel.tsx`：§4.7 所列 `id_scan` 分支与文案。
- 浏览器端细节：EXIF 由浏览器解码自动矫正；`URL.createObjectURL` 用后 revoke；解码失败诚实报错；离开页面 best-effort 清理已上传文件。

## 八、复用与不复用

**复用**：`StorageService.getObject()`、`FilesService.upload()/ownerDelete()/systemDelete()`、`signFileUrl()`、`countPdfPages()`、`image-dimensions.util.ts`、`UploadSessionQrPanel`（含 `purpose` prop）、`makePrintParams()`、Redis `setNxEx()`、`FilesCleanupTask` cron、`AuditService.write()`、`assertUserTaskAllowed()`、既有打印计费 `quotePrint`、kiosk 上传通道（裁剪产物，`kiosk-upload-options` DTO 已含 `id_scan`）。

**不复用/不做**：`@napi-rs/canvas` 服务端解码（SIGSEGV 崩溃面，§一）；`PrintMaterialCheckPage`（第三方 OCR）；Terminal Agent `imageToPdf()`；任何第三方图像 API（本期零外调）；新图像依赖（sharp 等）。

## 九、合规与诚实文案

页面必须包含（进 `COMPLIANCE_COPY` 或页内固定文案，实现时统一）：

1. 隐私：「证件照仅用于本次排版打印，最迟 1 小时内自动删除，不长期保存，不用于其他用途；本机选择的原始照片不会上传，仅裁剪结果用于生成打印文件」。**不复用**带"可能通过第三方 OCR 识别文字"字样的既有 `KIOSK_PRINT_SCAN_SENSITIVE` 通用文案——本功能不接 OCR，复用会构成误述，单独措辞。
2. 能力诚实：「本服务不提供自动抠图/换底色，请上传纯色底（白/蓝/红）标准证件照片」。
3. 质量诚实：「彩色激光打印效果，适合临时应急使用，非照相馆冲印质量」；禁止"照相馆级""高清冲印"等表述。
4. 规格免责：「各受理机构对照片可能有特殊要求，请以受理机构要求为准」。
5. 不新增任何招聘闭环能力；按钮文案不涉投递/预约白名单场景。

## 十、验证计划

- 新增 `verify:id-photo`（进双 CI，同格式转换模式），覆盖：
  - 未知 specId / 非 JPEG/PNG / 超 10MB → 对应错误码
  - 尺寸不精确匹配目标像素（偏大/偏小/宽高互换）→ `IDPHOTO_DIMENSIONS_MISMATCH`
  - 越权（会员访问他人 `id_scan` 文件 / 游客 capability URL 与 fileId 不匹配 / purpose 非 `id_scan`）→ 404
  - 成功生成 → 输出 1 页 PDF、`purpose='id_photo_print'`、`assetCategory='derived'`、`sourceFileId` 正确、TTL 1 小时、尝试延长保存 → 拒绝
  - 构造损坏/畸形 JPEG（截断、伪造魔数、异常 marker）→ 结构化错误，**API 进程不退出**（服务端无原生解码，此断言应恒真，防回归）
  - 幂等：同 key 重复请求返回同一输出；输出文件删除后命中缓存 → 清缓存重新生成；同 key 不同 spec/文件 → 409；缓存命中仍执行能力门禁（strict 模式下未配置终端被拒）
  - 删除端点：会员本人可删、游客凭 action token 可删、读取 `fileAccessUrl` 冒充删除凭证 → 拒绝（token 不可互换断言）、重复删除幂等、审计落库
  - 建单后服务端自动删除 `sourceFileId` 源文件 + `id_photo.source_deleted` 审计
  - `id_photo_print` 建单参数契约：`scale!='actual'` 或黑白/双面 → `PRINT_PARAMS_INVALID_FOR_ID_PHOTO`
  - 材料任务对 `id_photo_print`/`id_scan` 拒绝进入 `pii_scan`（OCR 隔离断言）
  - 扫码上传 confirm（`id_scan`）产生 `file.upload` 审计
  - 输出为内部 HMAC `printFileUrl` 而非 COS 预签名
- Kiosk 页面 mock 模式浏览器走查：规格选择 → 本机/扫码两来源 → 低分辨率拒绝与警告、比例偏差提示、竖拍手机照方向正确（EXIF）→ 裁剪预览 → 生成 → 跳 `/print/confirm` 携带契约参数 → 「立即删除」可用。
- typecheck / lint / 既有 verify 回归（files / retention / print-conversion / upload-sessions 相关）。
- **真机验收清单**（追加进 `docs/device/production-deployment-and-windows-host-checklist.md`）：彩色出纸；`scale=actual(noscale)` 实物量尺（一寸 25×35mm ±1mm，超差先查打印机驱动缩放设置）；"采集→使用→删除→审计"全链路演练（扫码上传→裁剪→生成→打印→确认裁剪产物被服务端删除→cron 清理排版 PDF→审计事件齐全）；建单后延迟 >30 分钟 claim 的任务按"URL 过期"诚实失败。

## 十一、风险与遗留

| 风险 | 处理 |
|---|---|
| Agent 彩色出纸与 `noscale` 尺寸均未真机验证 | 硬上线 gate（§六），验收前功能不点亮 |
| pdfkit 同 Buffer 多格嵌入的体积行为未实测 | 实现第一步先 spike 实测，超限则 XObject 复用或降质量 |
| 建单后 30 分钟未 claim 必然失败（打印域通用） | MVP 接受诚实失败；"claim 时重签 URL" 列为打印域独立后续任务 |
| 旧浏览器 EXIF 自动矫正不生效（老 Chromium） | Kiosk 为受控环境（现代 Edge/Chrome 全屏 Kiosk 模式），走查时在目标浏览器版本验证竖拍照片 |
| 前端被绕过、直接上传恰好目标像素的任意图片 | 无安全增量（用户自己的照片自己付费打印）；服务端尺寸锚定保证规格不失真 |
| 格式转换遗留的 `FilesService.upload()` 先写存储后建记录的孤儿对象问题 | 预先存在，不在本设计范围（同格式转换 §九结论） |
| `id_photo_print` 文件有活跃打印任务时仍可能被 cron 到期删除（"活跃任务保护"目前只覆盖招聘会 bridge 文件） | 与 30 分钟 URL 窗口叠加后实际影响极小（任务窗口 < 文件 TTL）；不为证件照单独改 cron 语义，如实记录 |
| 二期抠图换底 | 云 API 路线；人脸照片出内网必须独立隐私评审 + 页面明示 + 用户逐次同意 + 计费评估，禁止静默混入；若届时需要服务端图像处理，必须先落 child_process 进程隔离设计 |

## 十二、评审吸收记录（外部 Codex architect 只读评审，2026-07-12）

评审结论原文为"暂不进入实现计划阶段"，列 3 个 P0 阻断项；本版全部吸收后方可进入 `writing-plans`：

| 评审发现 | 严重度 | 本版处理 |
|---|---|---|
| API 主进程原生解码用户图片 = 已复现两次的 SIGSEGV 整进程崩溃面 | P0 | **架构改为前端浏览器裁剪**，服务端全程零原生解码（比评审建议的 child_process 隔离更彻底，同时消除 EXIF 问题与子进程运维负担）；`@napi-rs/canvas` 退出本设计 |
| `makePrintParams` 默认 `scale:'fit'` → Agent"适合页面"缩放，规格尺寸失真；`/print/confirm` 无参数编辑，"确认页提示改黑白"不可能发生 | P0 | 证件照专用参数契约（`scale:'actual'` 等五项固定）；参数在 IdPhotoPage 定死；服务端按 `purpose='id_photo_print'` 强校验建单参数；MVP 取消黑白选项 |
| 隐私生命周期三断点：前端触发删除不可靠 / 扫码上传路径无上传审计 / `HIGH_RISK_PII_PURPOSES` 零引用、材料链路可把高敏文件送外部 OCR | P0 | 删除改为建单事务后的服务端事件（前端手动删除降级为辅助）；`UploadSessionsService` 注入 AuditService 补 `file.upload` 审计；材料任务按可信 purpose 显式拒绝 + 「我的文档」不提供材料检查入口 |
| 时序不是"约 55 分钟"：两个独立 30 分钟窗口，claim 原样返回 URL 不重签 | P1 | §六如实改写；claim 重签列为打印域独立后续任务 |
| 游客删除授权不能复用读取 `fileAccessUrl`（read capability 扩张为破坏性操作；且 30 分钟后过期无法手动删） | P1 | 独立 `aud='id_photo_delete'` action token，绑定 fileId、请求体传输、有效期覆盖文件剩余 TTL |
| 分辨率公式不精确 + EXIF Orientation 未处理 | P1 | 前端按目标宽高比算裁剪区域并校验双边；EXIF 由浏览器解码自动矫正；服务端改为"裁剪产物精确等于目标像素"锚定 |
| 幂等/限流停留描述层（fingerprint 未含 specId、缓存命中可绕门禁、10 分钟 completed TTL 照搬会允许重复生成高敏 PDF） | P1 | §4.10 三点强化 + 三维限流 + 锁语义（TTL 自动释放）写明 |
| 集成清单缺项（app.module、routes、shared 导出、CI、QrPanel 文案、注释）；「我的文档」操作矩阵未定义；重印因果不准（依赖输出文件而非源文件）；审计失败静默；浏览器端细节 | P1/遗漏 | §4.1、§4.6、§4.7、§五操作矩阵、§4.5 审计强一致、§七浏览器细节逐项补齐 |

评审中确认**成立**的关键假设（保留）：`id_scan` 策略与 1 小时 TTL、`system_short` 锁定、每小时 cron 物理删除、`PURPOSE_FOLDER` 类型兜底、格式转换授权/幂等模式可迁移、`image-dimensions.util.ts` 可复用（纯 JS）、彩色计费 `print_color_page`、`id_photo` 能力键与 managed/strict 门禁语义、Kiosk 页面改造兼容性。

---

本文档为 brainstorm 阶段设计（含一轮外部评审吸收）。下一步：用户审阅确认 → 转入 `writing-plans` 产出实现计划。**设计确认前不写任何实现代码。**
