# 格式转换（图片→PDF）设计文档

> 日期：2026-07-11
> 关联文档：[home-entry-closure-plan-2026-07-11.md](../../reviews/home-entry-closure-plan-2026-07-11.md) | [user-data-flow-matrix.md](../../product/user-data-flow-matrix.md) | [next-tasks.md](../../progress/next-tasks.md)（"首期格式转换与签名盖章"条目）
> 状态：brainstorm 阶段设计，未开始实现。已经外部 Codex（backend architect 角色）只读评审并采纳其全部安全/技术修正。

## 一、背景与范围

Kiosk 首页「打印扫描」分组和 `/print-scan` 服务中心里的「格式转换」入口目前是 disabled 占位卡片。本设计把它做成一个可独立交付的 MVP：**把多张图片合并为一份 PDF，然后直接进入打印确认流程**。

**MVP 范围（明确边界）**：

- ✅ 图片（JPEG/PNG）→ 合并为一份多页 PDF
- ❌ PDF → 图片（逐页导出）：需要新的 PDF 栅格化依赖（如 pdfjs-dist），推迟到后续独立评估
- ❌ Word/Excel/PPT → PDF：需要 LibreOffice 级别的排版渲染能力，工程量完全不同，需另立项
- ❌ WebP 等其他图片格式：当前 `pdfkit@0.15.2` 只识别 JPEG/PNG，仓库现有 `print_doc` 校验虽然包含 webp，但转换功能仅接受 JPEG/PNG（见 §四）
- ❌ 图片旋转/裁剪/滤镜等编辑能力：这是格式转换，不是图片编辑器

不新增 Prisma 模型、不新增 `FilePurpose` 枚举值、不新增图像处理类依赖（复用仓库已有的 `pdfkit`）。

## 二、用户流程

1. 用户从「格式转换」入口进入新页面（替换现有 `PrintScanFeatureInfoPage.tsx` 里 `convert` key 对应的纯说明视图）。
2. 添加图片，两种来源均可混用，**都遵循"加一张、可继续添加"的同一模式**（自查阶段发现：`PrintUploadPage.tsx` 里现有的本机 `<input type="file">` 其实是单文件选择，代码注释明确标注它是"A2 桌面浏览器验证模式"，生产 Kiosk 真正的本机文件来源是依赖 Terminal Agent 监听目录的 A1 方案——这部分硬件能力尚未建成，属于「U盘导入」那类未开工的硬件依赖项。因此本设计不假设本机上传能一次多选）：
   - **本地上传**：复用现有单文件 `<input type="file">`（沿用其"A2 桌面验证"定位，不新增能力承诺），每次选一张加入待合并列表。
   - **手机扫码上传**：复用现有 `UploadSessionQrPanel`/`PhoneUploadPage` 机制，**一次扫码只传一张**（现有会话机制的真实限制，见 §五-3）；上传确认后一体机把这张图加入待合并列表。
   - 无论哪种来源，用户都可以点击「继续添加」重复以上任一方式，直到图片选够。
3. 用户可对已添加的图片调整顺序（上移/下移，不引入拖拽库）、可移除某张。
4. 点击「生成 PDF」→ 后端合并 → 前端拿到结果 → 直接跳转 `/print/confirm`，同时该 PDF 已落入「我的文档」（登录会员）。
5. 用户在打印确认页正常完成后续打印流程（本设计不改打印确认/收银/打印任务链路）。

## 三、后端设计

### 3.1 新模块

新增 `services/api/src/print-conversion/`（独立小模块，参照 `upload-sessions`、`scan-tasks` 等既有模块的组织方式），包含：

- `print-conversion.controller.ts` — `POST /print/convert/images-to-pdf`
- `print-conversion.service.ts` — 核心合并逻辑
- `dto/convert-images.dto.ts`

不复用 `apps/kiosk/src/services/api/httpAdapter.ts`（Codex 核实该文件实际是招聘会 GET 适配器，不是通用 HTTP 客户端）；前端新增独立的 `apps/kiosk/src/services/api/printConversion.ts`。

### 3.2 请求契约

```text
POST /print/convert/images-to-pdf
Headers:
  Authorization: Bearer <member token>          # 登录会员场景
  Idempotency-Key: <前端首次点击生成时创建的 key>

Body:
{
  sources: [
    { fileId: string, fileAccessUrl: string }   // fileAccessUrl = 上传/扫码确认后现有的 HMAC /files/:id/content?expires&sig
  ]  // 1..20 项，按数组顺序即最终页面顺序
}
```

`fileAccessUrl` 只作为**授权凭证**校验（签名、有效期、其中的 fileId 与请求项一致），**不用于实际读取**——实际读取永远走数据库 `storageKey + bucket`，避免 SSRF。这是 Codex 评审的核心修正：仅凭 `fileId` 无法证明"这张匿名图片属于当前这次操作"，必须要求调用方同时出示这张图片的访问凭证。

### 3.3 归属校验

**登录会员**：批量查询全部唯一 `fileId` 后按请求顺序重排，每个文件必须同时满足：

```text
status = 'active'
deletedAt = null
expiresAt IS NULL OR expiresAt > now
purpose = 'print_doc'
mimeType IN ('image/jpeg', 'image/png')
endUserId = 当前会员
ownerType = 'user'
ownerId = 当前会员
```

任一条件不满足 → 统一返回 `CONVERT_SOURCE_NOT_FOUND`（404），不区分"不存在"还是"他人文件"，避免文件 ID 探测。

**游客**：除以上通用状态/MIME 检查外，额外要求：

```text
验证每个 fileAccessUrl 的 HMAC 签名与有效期
URL 中的 fileId 必须与请求项 fileId 一致
数据库记录必须是 endUserId=null, ownerType='system', ownerId=null
```

不允许仅凭 `ownerType='system'` 放行（这只能证明"是某个匿名文件"，不能证明"属于这次操作"）。

### 3.4 读取与合并

- 使用 `StorageService.getObject(storageKey, bucket)` **逐个顺序读取**（禁止 `Promise.all(fileIds.map(getObject))`，避免瞬时内存峰值和存储端并发压力）。
- 每张图片嵌入前校验：JPEG/PNG 魔数与数据库 `mimeType` 一致；宽高非零且不超过单张像素上限。
- 用仓库已有 `pdfkit` 依次把每张图片作为一页嵌入，使用 `fit: [width, height]` 保持比例（不同时传固定 `width + height + fit`，避免拉伸变形）。
- 一次性在内存生成完整 PDF Buffer 后再落库上传，不采用逐张写入再拼接的方式；任一环节失败则整体失败，不产出"部分合并"的半成品文件。
- 生成完成后用现有 `countPdfPages()` 校验输出页数等于输入图片数量。

### 3.5 输出与落库

复用 `FilesService.upload()`：

```text
purpose = 'print_doc'
assetCategory = 'derived'
sourceFileId = null   // 多输入无法用单一字段表达血缘，不可随意填第一张图片的 id
```

审计日志记录：有序源文件数量、来源 fileId 摘要（不记录文件正文/像素数据）。若未来需要完整多对多血缘关系，再单独设计，本轮不做。

返回给前端：

```text
{
  fileId: <输出 FileObject id>,
  printFileUrl: <signFileUrl(fileId, 30分钟) 生成的内部 HMAC URL>,  // 不是 COS 预签名 URL
  fileMd5: <输出 FileObject.sha256>,
  pages: <图片数量>
}
```

`printFileUrl` 与 COS `signedUrl` 命名区分明确，避免前端误用——`PrintJobsService.create()` 只接受本系统 HMAC `/files/:id/content` 格式的 URL，不接受 COS 预签名地址。

### 3.6 资源限制

| 项目 | 限制 |
|---|---|
| 图片数量 | 1–20 张 |
| MIME | 仅 `image/jpeg`、`image/png` |
| 单张压缩文件大小 | 最多 10MB（与扫码路径一致） |
| 输入压缩字节总和 | 最多 40MB |
| 单张像素 | 最多 25MP |
| 总像素 | 最多 200MP |
| 频控 | 同一用户/IP/终端最多 3 次/分钟 |
| 单实例并发转换数 | 最多 1–2 个 |
| 重复 `fileId` | 直接拒绝，不静默去重 |
| 输出 PDF 大小 | 最多 15MB（由 `PROXY_MAX_BYTES` 决定；如需放宽到 20MB 需为"服务端可信生成物"新增独立写入模式，本轮不做，MVP 接受 15MB 上限） |

以上限制专属本功能，不依赖/不修改现有 `print_doc`/`temp` policy（那两个策略只管单文件上传大小，不管本功能的累计张数/像素/并发）。

### 3.7 幂等性

前端首次点击「生成 PDF」时创建 `Idempotency-Key`（同一批图片的重试复用同一个 key）。后端 Redis 记录：

```text
key → 请求方身份 + 有序 fileIds 指纹 + 状态 + outputFileId
```

行为：

- 同 key、同请求、已完成 → 返回已有输出，重新签发 `printFileUrl`
- 同 key、同请求、处理中 → `409 CONVERSION_IN_PROGRESS`
- 同 key、不同请求（图片列表变了）→ `409 IDEMPOTENCY_KEY_REUSED`
- 生成失败 → 释放锁，允许重试
- 前端按钮在请求中禁用，避免双击

已知局限（MVP 接受）：进程在"输出 FileObject 已创建、Redis 尚未记录成功"之间崩溃时仍可能重复生成；没有数据库唯一幂等字段无法保证严格 exactly-once。MVP 采用"Redis 并发去重 + 前端防双击"，不追求数据库级强幂等。

### 3.8 错误码

```text
CONVERT_INPUT_INVALID
CONVERT_TOO_MANY_IMAGES
CONVERT_SOURCE_NOT_FOUND
CONVERT_SOURCE_TYPE_UNSUPPORTED
CONVERT_SOURCE_TOO_LARGE
CONVERT_IMAGE_DIMENSIONS_INVALID
CONVERT_TOTAL_LIMIT_EXCEEDED
CONVERT_OUTPUT_TOO_LARGE
CONVERSION_IN_PROGRESS
CONVERT_FAILED
```

**2026-07-11 实现落地更正**：`CONVERT_STORAGE_UNAVAILABLE` 最终未实现——`storage.getObject()` 读取失败未单独包裹为结构化错误码，走全局 `HttpExceptionFilter` 兜底为通用 `500 INTERNAL_SERVER_ERROR`（不泄露存储路径/内部细节，安全性不受影响，仅错误信息不够具体）。实现时新增了 `IDEMPOTENCY_KEY_REUSED`（同 key 不同图片列表冲突，见 §3.7）作为补充。

所有错误响应不包含存储路径、COS 响应正文、签名 URL 或堆栈信息。

## 四、与打印确认页的衔接

转换端点**不创建** `PrintTask`、订单或 `paymentSessionToken`——这些仍由用户在 `/print/confirm` 最终点击打印时，经现有 `createPrintJob()` 触发（后端才返回 `paymentSessionToken` 并分流收银/打印进度），本设计不复制这部分逻辑。

跳转 `/print/confirm` 时传递：

```text
file:
  name, size
  pages = 输入图片数量
  fileId
  fileUrl = printFileUrl（30 分钟内部 HMAC）
  fileMd5 = 输出 FileObject.sha256
  mimeType = 'application/pdf'
params: makePrintParams(...)（复用现有构造函数）
source: 'document'
```

同时写入现有 `printMaterialSession`，避免用户刷新确认页后丢失文件。

## 五、前端改动范围

- 新页面（替换 `PrintScanFeatureInfoPage.tsx` 的 `convert` key 视图）：本地单文件上传 + 手机扫码，均为"一次一张、可继续添加" + 已选图片列表（排序/移除）+「生成 PDF」按钮。
- `PrintScanHomePage.tsx`：`convert.available` 从 `false` 改为 `true`；描述文案从"文档与图片格式互转"收窄为"多张图片合并为 PDF"，避免继续显示"即将上线"或承诺尚未支持的 Word/PDF 互转能力，造成能力误导（Codex 评审明确指出的同步遗漏点）。
- `apps/kiosk/src/pages/home/HomePage.tsx` 的"格式转换"磁贴：从 `disabled: true` 改为指向新页面路由。
- 新增 `apps/kiosk/src/services/api/printConversion.ts`（独立 API 模块，不复用 `httpAdapter.ts`）。

## 六、复用与不复用

**复用**：
- `StorageService.getObject()`（兼容本地/COS 历史数据）
- `FilesService.upload()`（落 FileObject、SHA-256、保存策略、资产分类）
- `signFileUrl()`（生成打印链路需要的内部 HMAC URL）
- `countPdfPages()`（输出完整性校验）
- `UploadSessionQrPanel`（按"一次一张、继续添加"使用，组件本身不用改）
- `makePrintParams()`（构造 `/print/confirm` 参数）
- 现有 Redis `setNxEx()`（转换锁/幂等控制）

**不复用**（评审明确排除，避免走弯路）：
- Terminal Agent 的 `imageToPdf()`：处理本地路径和单张图片/临时文件，不适合 API/COS 场景，仅供参考 A4 排版方式
- `MaterialsService.bundle_render`：目前只是 `pending/skeleton`，没有真实渲染实现
- `apps/kiosk/src/services/api/httpAdapter.ts`：实际是招聘会 GET 适配器

## 七、数据归属与保存策略

按 `user-data-flow-matrix.md` 既定口径，转换后的 PDF 落「我的文档」，登录会员输出正确绑定 `endUserId` 后会被现有 `MemberAssetsService.listDocuments()` 自动收录，不新增分组或模型。

**保存期限（已与产品侧确认，零改动）**：`print_doc` 用途目前不在会员默认 90 天保存名单内，因此哪怕是登录会员生成的转换 PDF，默认也按普通文件保存约 24 小时（`system_short`）；用户需要自己在「我的文档」页面主动延长保存期限（3 个月/6 个月/长期），这与当前 `print_doc` 默认策略完全一致，不新增策略例外。游客生成的 PDF 同样按现有匿名文件短期策略处理。

## 八、合规边界

- 不触碰招聘平台合规红线（本功能是纯文件工具服务）。
- 私有文件、短期签名 URL、自动清理、审计日志，均沿用现有机制。
- 审计日志不记录文件正文、像素数据或签名串。

## 九、已知遗留问题（不在本设计范围内，仅记录）

Codex 评审中发现一个**预先存在、与本功能无关**的问题：`FilesService.upload()` 当前是"先写对象存储、后建 `FileObject` 记录"，中间若失败会留下存储层孤儿对象，没有补偿清理逻辑。这个问题影响的是所有调用 `FilesService.upload()` 的既有功能，不是本功能引入的缺陷，本设计不在此范围内修复，建议作为独立任务跟进。

## 十、验证计划

- 新增 `verify:print-conversion`（或类似命名），覆盖：
  - 空列表/超过 20 张 → 拒绝
  - 非 JPEG/PNG → `CONVERT_SOURCE_TYPE_UNSUPPORTED`
  - 越权（会员访问他人文件 / 游客 fileAccessUrl 与 fileId 不匹配）→ `CONVERT_SOURCE_NOT_FOUND`
  - 重复 `fileId` → 拒绝
  - 超过累计大小/像素上限 → 对应错误码
  - 成功合并 N 张图片 → 输出 PDF 恰好 N 页，`assetCategory='derived'`，`sourceFileId=null`
  - 相同 `Idempotency-Key` 重复请求 → 返回同一输出，不重复生成
  - 输出 `printFileUrl` 而非 COS `signedUrl`
- Kiosk 新页面 mock 模式浏览器走查：本地单文件上传 + 手机扫码均按"一次一张、继续添加"加满待合并列表 → 排序 → 生成 → 跳转 `/print/confirm` 携带正确文件信息。
- `PrintScanHomePage.tsx`、`HomePage.tsx` 改动后的 typecheck/lint。

---

本文档为 brainstorm 阶段最终设计，尚未开始实现。下一步：用户审阅本文档 → 确认无误后转入 `writing-plans` 技能产出具体实现计划。
