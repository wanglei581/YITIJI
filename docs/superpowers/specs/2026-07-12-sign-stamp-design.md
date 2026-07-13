# 签名盖章（图形排版）设计文档

> 日期：2026-07-12
> 关联文档：[2026-07-11-format-conversion-design.md](./2026-07-11-format-conversion-design.md) | [user-data-flow-matrix.md](../../product/user-data-flow-matrix.md) §3.4 | [next-tasks.md](../../progress/next-tasks.md)（"首期签名盖章"条目）| [compliance-boundary.md](../../compliance/compliance-boundary.md)
> 状态：brainstorm 阶段最终设计。已经外部 Codex（Backend Architect 角色）只读评审（2026-07-12，session `019f563b-3a89`），其 4 项 High 级阻塞与全部事实修正已吸收（见 §十二 评审吸收记录）。未开始实现。

## 一、背景与范围

Kiosk `/print-scan` 服务中心的「签名盖章」卡片目前 `available:false`，`/print-scan/feature/sign` 是 MVP 说明页占位（`PrintScanFeatureInfoPage.tsx`）。本设计把它做成可独立交付的 MVP：**在用户自己的 PDF 文件指定页、指定预设位置叠加一张签名或印章图片，合成新 PDF 后进入既有打印确认流程**。

产品定位（`next-tasks.md` 既定口径）：**只是图形排版能力**，非 CA 电子签、非电子认证、无任何法律效力，必须展示既有 `COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE` 免责声明。

**用户已拍板的 4 项范围决策（2026-07-12）**：

1. 签名/印章图片来源：**手机扫码上传图片**（复用已验证的 `UploadSessionQrPanel` 机制，本机单文件上传同样提供）；触屏手写板不进 MVP。
2. 定位交互：**预设九宫格位置 MVP**，触屏拖放定位（需 pdfjs-dist 前端渲染）列为二期。
3. 被签文件来源：**新上传（本机单文件 + 手机扫码，照搬格式转换模式）+「我的文档」已有 PDF**（`MyDocumentsPage` 新增动作入口）。
4. 新依赖：**同意引入 `pdf-lib`**（服务端）。

**依赖事实（已核实并经外部评审复核）**：仓库现有 `pdfkit@0.15.2` 只能从零生成新 PDF；已有 `unpdf@1.6.2`（内置 pdfjs，`resume-extraction.service.ts` 在用）提供**只读解析**能力，但无法在已有 PDF 上叠图编辑；全仓库无 pdf-lib / 独立 pdfjs-dist / mupdf 等 PDF 编辑依赖。因此引入 `pdf-lib` 是"在已有 PDF 上叠图"的必要条件。

**MVP 范围（明确边界）**：

- ✅ 已有 PDF + 一张 PNG/JPG 签名或印章图片 → 指定页 + 九宫格位置 + 大小档位 → 合成新 PDF → 预览 → 进打印
- ✅ 「再加一处」：合成产物可作为下一轮输入，循环叠加多处签名/印章（见 §2.6）
- ✅ 新增 `FilePurpose` 枚举值 `signature_image`（签名/印章图片专用，高敏感 + 锁定短期留存，见 §七；这是评审后对初稿"不新增 purpose"的显式推翻，理由见 §十二-B1）
- ❌ 触屏手写板（无现成 canvas 代码，二期评估）
- ❌ 触屏拖放任意定位（需 pdfjs-dist 前端渲染 PDF 页，二期评估）
- ❌ 图片抠图/去底/EXIF 方向归一化（不新增 sharp 等图像处理依赖；方向问题靠页面提示 + 结果预览兜底，见 §3.4-5）
- ❌ 直接给图片文件（JPG/PNG 原件）盖章：图片先走既有「格式转换」转成 PDF，再进本功能（有真实入口衔接，不在本模块重复实现图片→PDF）
- ❌ 骑缝章、每页批量盖章、印章旋转角度
- ❌ 带数字签名域的 PDF（检测到即拒绝，见 §3.4-3）
- ❌ 内置印章图库 / 印章模板 / 印章生成器（合规红线，见 §八）

不新增 Prisma 模型；新增唯一后端依赖 `pdf-lib`；新增一个 `FilePurpose` 枚举值 `signature_image`。

## 二、用户流程

1. 入口**两路**（评审修正：首页「打印扫描」分组现无"签名盖章"磁贴，按入口稳定规则**不新增首页磁贴**）：
   - `/print-scan` 服务中心「签名盖章」卡片（`available` 改为 true，服务端能力断言为权威门禁，见 §3.9）→ 新页面 `/print-scan/sign`；
   - `MyDocumentsPage` 对 `mimeType='application/pdf'` **且 purpose 在 §3.3 文档白名单内**的文档新增「签名盖章」动作：复用其「打印」动作的 `fetchAccessUrl` 模式换取短期签名 URL，携 `location.state` 直达 `/print-scan/sign`（跳过步骤 2）。前端展示条件与后端白名单一致，避免可点入口换来 404。
2. **选择文档**（照搬 `ConvertImagesPage` 双通道）：本机单文件 `<input type="file" accept="application/pdf">`（沿用"A2 桌面验证"定位）或手机扫码上传（`UploadSessionQrPanel`，purpose=`print_doc`）。仅接受 PDF。
3. 文档就绪后前端调 `POST /print/sign/inspect` 获取页数并早失败（加密 / 损坏 / 含数字签名域 / 超页数的 PDF 此时即报错，不让用户白选位置）。
4. **添加签名/印章图片**：本机单文件或手机扫码上传一张 PNG/JPG（purpose=`signature_image`，见 §七）。页面提示："建议上传白底或透明底 PNG；若图片方向不对，请在手机上旋转后重新上传"。
5. **选位置**：页码选择（默认最后一页，可选第 1 页 / 最后一页 / 数字键盘输入指定页）+ 九宫格位置（默认右下）+ 大小三档（小/中/大）。全部为大按钮触控交互，主操作 ≥56px、可点击区域 ≥48px。
6. **授权确认**：生成按钮上方勾选"我确认本人拥有该签名/印章图片的使用授权，仅用于本人材料的版式整理"（默认不勾选，勾选后按钮可用；确认动作与文案版本进审计，见 §3.10）。
7. 点「生成合成 PDF」→ `POST /print/sign/compose` → 后端 pdf-lib 合成 → 返回派生 FileObject。
8. **结果预览**：页面内 `<iframe>` 预览合成 PDF（沿用 `PrintPreviewPage.tsx` 内部私有 `FilePreviewPanel` 的 iframe **模式**，不抽公共组件），三个动作：
   - 「去打印」→ `navigate('/print/confirm', { state })`（同格式转换）；
   - 「再加一处签名/印章」→ 以合成产物为新的输入文档回到步骤 4（见 §2.6）；
   - 「重新选位置」→ 保留原文档与图片，回步骤 5，换新 Idempotency-Key 重新合成。UI 提示：每次生成都会产生一份新文件，旧文件按短期策略自动清理。
9. 打印确认/收银/打印任务链路零改动。

**异常路径（评审补充）**：凭证（30 分钟 HMAC URL）或会员登录态在长时间操作中过期时，`resolveOptionalEndUser()` 会把过期会员降级为游客，后端统一返回 `SIGN_SOURCE_NOT_FOUND`。前端不得笼统提示"文件不存在"：对「我的文档」入口与已登录会话，提示"文件访问凭证已过期，请重新获取/重新登录"并提供重新换取凭证（`fetchAccessUrl`）或跳登录的动作。

### 2.6 「再加一处」循环

`compose` 返回的 `printFileUrl` 本身就是 `/files/:id/content?expires&sig` 格式的内部 HMAC URL，与上传/扫码确认后拿到的 `fileAccessUrl` 同构——它天然可以作为下一轮 `document.fileAccessUrl` 授权凭证（会员路径走 `endUserId` 归属，游客路径走 HMAC 凭证校验）。因此多处签名 = 用户在结果页循环操作，后端零新增代码。

## 三、后端设计

### 3.1 新模块与公共函数

新增 `services/api/src/print-sign/`（独立小模块，组织方式照搬 `print-conversion/`）：

- `print-sign.controller.ts` — `POST /print/sign/inspect`、`POST /print/sign/compose`
- `print-sign.service.ts` — 归属校验 + pdf-lib 合成
- `print-sign.dto.ts`、`print-sign.types.ts`、`print-sign.module.ts`

新依赖：`pdf-lib`（services/api dependencies；纯 JS、MIT、零原生绑定）。核心 API：`PDFDocument.load(buffer)`、`getPageCount()`、`embedPng/embedJpg`、`page.getSize()/getRotation()/getCropBox()`、`page.drawImage()`、`save({ useObjectStreams: false })`。

**HMAC URL 解析收敛（评审采纳）**：内部签名 URL 的"解析 + 验签"逻辑目前在 print-conversion / print-jobs / print-page-count 三处各有私有实现。本模块**不复制第四份**：在 `services/api/src/files/signing.ts` 新增公共 `parseAndVerifySignedContentUrl(url): { fileId } | null`，print-sign 使用它。既有三处的重构收敛**不在本设计范围**（避免范围膨胀），列为独立跟进建议。

**共享契约（评审采纳）**：新增 `packages/shared/src/types/printSign.ts`（请求/响应结构、position/size 枚举、`SIGN_*` 错误码常量），Kiosk 前端从 shared 引用，后端保留本地镜像——与 `printConversion.ts` 的既有做法一致。

### 3.2 请求契约

```text
POST /print/sign/inspect
Headers: Authorization?: Bearer <member token>（可选，游客可用）
Body: { terminalId: string, document: { fileId, fileAccessUrl } }
→ 200 { pages: number }
```

```text
POST /print/sign/compose
Headers:
  Authorization?: Bearer <member token>
  Idempotency-Key: <前端首次点击生成时创建；格式约束见 §3.7>
Body:
{
  terminalId: string,
  document: { fileId: string, fileAccessUrl: string },   // PDF
  stamp:    { fileId: string, fileAccessUrl: string },   // PNG/JPG
  placement: {
    page: number,                    // 1-based，必须 ∈ [1, 文档页数]
    position: 'top-left' | 'top-center' | 'top-right'
            | 'middle-left' | 'center' | 'middle-right'
            | 'bottom-left' | 'bottom-center' | 'bottom-right',
    size: 'small' | 'medium' | 'large'
  },
  authorizationConfirmed: true       // §二-6 的勾选，必须为 true
}
→ 200 { fileId, printFileUrl, fileMd5, sizeBytes, pages }
```

`fileAccessUrl` 沿用 print-conversion 的定位：**只作为授权凭证校验**（HMAC 签名、有效期、其中 fileId 与请求项一致），实际读取永远走数据库 `storageKey + bucket`，防 SSRF。**语义说明（评审采纳）**：与 print-conversion 相同，会员路径实际以 `endUserId` 归属为准、不校验该 URL（保留字段是为契约统一与游客路径服务）；`printFileUrl` 在共享类型中的注释需同步扩展为"供 `/print/jobs` 与签章类内部文件变换端点作为访问凭证使用"，避免契约漂移。

### 3.3 归属校验

照搬 `print-conversion.service.ts` 的 `verifySourceOwnership` 模式，对 `document` 与 `stamp` 两个文件分别校验；任一不满足统一返回 `SIGN_SOURCE_NOT_FOUND`（404，不区分"不存在/他人文件"，防 fileId 探测）。

通用条件（两个文件都要求）：`status='active'`、`deletedAt=null`、`expiresAt` 为空或未过期。

- **会员**：`endUserId=当前会员 && ownerType='user' && ownerId=当前会员`。
- **游客**：`endUserId=null && ownerType='system' && ownerId=null`，且 `fileAccessUrl` 的 HMAC 签名有效、未过期、URL 内 fileId 与请求项一致。

类型约束（归属通过后单独校验，返回专属错误码）：

- `document`：`mimeType='application/pdf'`。purpose 白名单：**游客仅 `print_doc`**；**会员为 `print_doc` / `resume_upload` / `resume_scan` / `cover_letter`**（已核实覆盖「我的文档」全部真实 PDF 生产来源：AI 简历优化导出 = `resume_upload`（`ai.service.ts:655`），职业规划/参会准备单/面试报告 PDF = `print_doc`，求职信 = `cover_letter`）。**评审修正表述**：会员经 upload-intent 通道理论上还可产生 `temp` / `fair_material` 等其他含 PDF 的 purpose，白名单外一律拒绝（`SIGN_DOC_TYPE_UNSUPPORTED`），且前端「我的文档」动作按同一白名单显示（§二-1）。
- `stamp`：`mimeType ∈ {'image/png','image/jpeg'}` 且 `purpose='signature_image'`（本功能上传通道固定产生；不接受把普通 `print_doc` 图片当印章，保证敏感策略不被绕开）。

### 3.4 合成逻辑

1. `StorageService.getObject()` **顺序**读取 document、stamp（禁止 Promise.all，同 print-conversion）。
2. 读取后魔数复核：PDF 头 `%PDF`（与现有 `content-sniff.ts:49` 口径一致，四字节，不含连字符）、PNG/JPEG 魔数与数据库 `mimeType` 一致；stamp 用 `image-dimensions.util.ts` 解析宽高，校验非零且 ≤25MP。
3. `PDFDocument.load(documentBuffer)`（不传 `ignoreEncryption`）：
   - 加密 / 损坏 / 解析失败 → `SIGN_DOC_UNSUPPORTED`；
   - 加载成功后检测 AcroForm 签名域（数字签名字段）：**存在即拒绝** → `SIGN_DOC_HAS_DIGITAL_SIGNATURE`（叠图必然使原数字签名验证失效，MVP 选择 fail-closed 而非警告放行；检测不到的冷门签名形态按"尽力检测"处理并在免责声明中覆盖，见 §八）；
   - 页数 = `getPageCount()`，>30 → `SIGN_DOC_TOO_MANY_PAGES`。
4. 校验 `placement.page ∈ [1, 页数]` → 否则 `SIGN_PLACEMENT_INVALID`。
5. `embedPng`/`embedJpg` 嵌入图片；**嵌入抛错（CMYK JPEG、特殊 PNG 变体等 pdf-lib 不支持的编码）→ `SIGN_STAMP_UNSUPPORTED`，fail-closed**。EXIF 方向不做服务端归一化（MVP 边界）：靠上传提示 + 结果预览确认兜底，方向错误由用户旋转后重传。
6. **页面几何（评审采纳，扫描件常见）**：定位基准取目标页 `getCropBox()`（无 CropBox 时退回 MediaBox），并考虑 box 原点非零偏移；读取 `getRotation()`，对 90/180/270 的页面做坐标系变换并以 `drawImage` 的 `rotate` 参数同步旋转图片，保证九宫格位置与用户**视觉方向**一致。该几何换算是 `verify:print-sign` 的重点断言对象。
7. 尺寸换算：图片渲染宽 = 可视区宽 × 档位系数（small=15%、medium=25%、large=35%），高按图片原始纵横比等比换算；若等比换算后高度超过可视区高 × 同系数上限，则改用高度约束反算宽度（细长/竖长图不越界）。
8. 位置换算：九宫格 → (x, y)，四周留可视区宽/高 4% 边距；PDF 坐标系原点在左下角，top 行 y = 可视区顶 − 边距 − 图高，依此类推（叠加 §6 的旋转变换）。
9. `page.drawImage(...)` 叠加，`save({ useObjectStreams: false })` 输出 Buffer。**`useObjectStreams: false` 是硬性要求**：现有打印计费器 `countPdfPages()` 只扫描明文 `/Type /Page` 标记（`file-page-count.util.ts`），对象流压缩的 PDF 会数不出页数导致 `/print/jobs` 建单失败（`PRINT_PAGE_COUNT_UNAVAILABLE`）。验证计划含防回退断言（§十）。附带收益：明文重写后，部分原本对象流形态、现有计费器数不出的输入 PDF，合成产物反而变得可计费。
10. 输出校验（双保险）：`countPdfPages(输出) === getPageCount()`（既验"叠图不增删页"，又验"现有计费器可数出该产物"）→ 不等则 `SIGN_FAILED`；输出大小 ≤15MB → 否则 `SIGN_OUTPUT_TOO_LARGE`。
11. **解析型 DoS 防护（评审采纳）**：单实例并发合成上限 1–2（Redis 计数或进程内信号量，同 conversion 口径）；`load/save` 全程包一个总超时（如 10 秒），超时 → `SIGN_FAILED` 并释放幂等锁；文件大小/页数限制不能约束对象数与解析复杂度，故超时是最后防线，实现阶段需对超大页面尺寸/深层引用样本做一次真实压测。
12. 任一环节失败整体失败，不产出半成品。

### 3.5 输出与落库

复用 `FilesService.upload()`：

```text
purpose = 'print_doc'
assetCategory = 'derived'
sourceFileId = document.fileId       // 本功能有唯一主源文档，血缘可表达（stamp 记审计）
sensitiveLevel = max(document.sensitiveLevel, 'sensitive')   // 评审采纳：继承输入中较高者；
                                                             // 含真实签名的产物至少 sensitive，
                                                             // 简历类输入(highly_sensitive)则继承 highly_sensitive
filename = `${净化后的原文件名主干}-签章合成.pdf`
endUserId = 会员 id 或 null（游客）
```

**文件名净化（评审采纳）**：原文件名去路径分隔符/控制字符/重复扩展名，主干截断到安全长度（如 80 字符）后再拼后缀；来自手机上传与历史 FileObject 的 filename 不可直接拼接。

返回 `printFileUrl = signFileUrl(输出 fileId, 30 分钟)`（内部 HMAC URL，非 COS 预签名），`fileMd5` = 输出 FileObject.sha256（沿用现有字段命名兼容）。

### 3.6 资源限制

| 项目 | 限制 |
|---|---|
| document | 仅 `application/pdf`，≤15MB，页数 1–30；加密/损坏/解析失败与页数无法识别分别走 `SIGN_DOC_UNSUPPORTED`（不与"页数过多"混用同一错误码） |
| stamp | 仅 PNG/JPG（purpose=`signature_image`），≤10MB，≤25MP，宽高非零 |
| placement | page ∈ [1, 页数]；position/size 枚举白名单（DTO 层校验，错误按全局 `VALIDATION_FAILED` 契约返回） |
| 输出 PDF | ≤15MB |
| 频控 | compose 3 次/分钟、inspect 10 次/分钟；**会员维度 + IP 维度并用**（一体机共享出口 IP，纯 IP 限流会误伤，游客回落 IP 维度） |
| 并发 | 单实例并发合成 1–2；处理总超时约 10 秒 |

### 3.7 幂等性

Redis key `print-sign:idem:${endUserId ?? 'guest'}:${idempotencyKey}`，`setNxEx` 抢锁 TTL 120s、完成结果 TTL 600s，指纹 = `document.fileId + stamp.fileId + placement` 序列化哈希。

- `Idempotency-Key` 格式约束（评审采纳）：`[A-Za-z0-9_-]{16,80}`，DTO 层校验，防 Redis key 注入与超长 key。
- 同 key、同指纹、已完成 → **重验两个源文件归属 + 重验输出文件仍 `active` 未过期**（评审采纳：输出可能已被用户删除或清理任务处理，直接重签 URL 会返回不可用链接；输出失效时清除缓存条目并重新生成）→ 返回输出并重签 `printFileUrl`。
- 同 key、处理中 → `409 SIGN_IN_PROGRESS`
- 同 key、不同指纹 → `409 IDEMPOTENCY_KEY_REUSED`
- 失败释放锁（评审采纳，改进 conversion 的裸 `DEL`）：锁 value 写入本次请求随机 owner token，释放用 compare-and-delete（Lua `GET==token 才 DEL`），避免 120 秒锁过期后误删他人新锁/新结果。
- 「重新选位置」由前端换新 Idempotency-Key（指纹变了，旧 key 复用会被 `IDEMPOTENCY_KEY_REUSED` 拒绝，预期行为）。
- 已知局限同 print-conversion（Redis 去重 + 前端防双击，不追求数据库级 exactly-once），MVP 接受。

### 3.8 错误码

DTO 结构/枚举错误由全局 `ValidationPipe` 统一返回 `VALIDATION_FAILED`（评审修正：不另设 `SIGN_INPUT_INVALID`，避免同义错误码并存）。业务错误码：

```text
SIGN_SOURCE_NOT_FOUND            // 归属/凭证/状态不满足（统一 404 防探测）
SIGN_DOC_TYPE_UNSUPPORTED        // document 非 PDF 或 purpose 不在白名单
SIGN_DOC_UNSUPPORTED             // 加密/损坏/pdf-lib 无法加载/页数无法识别
SIGN_DOC_HAS_DIGITAL_SIGNATURE   // 检测到数字签名域，拒绝处理
SIGN_DOC_TOO_LARGE               // 文档超 15MB
SIGN_DOC_TOO_MANY_PAGES          // 页数 >30（可识别但超限）
SIGN_STAMP_TYPE_UNSUPPORTED      // 图片非 PNG/JPG 或 purpose 非 signature_image
SIGN_STAMP_UNSUPPORTED           // pdf-lib 嵌入失败（CMYK JPEG 等编码变体）
SIGN_STAMP_TOO_LARGE             // 图片超 10MB / 25MP
SIGN_PLACEMENT_INVALID           // 页码越界
SIGN_OUTPUT_TOO_LARGE            // 输出超 15MB
SIGN_IN_PROGRESS                 // 幂等锁占用
IDEMPOTENCY_KEY_REUSED           // 同 key 不同指纹（复用现有错误码）
SIGN_FAILED                      // 合成失败/超时/输出校验不一致兜底
```

能力断言失败复用 `terminal-capabilities.service.ts` 既有错误码（`CAPABILITY_UNAVAILABLE` / `CAPABILITY_NOT_CONFIGURED`）。所有错误响应不含存储路径、COS 响应正文、签名 URL 或堆栈。

### 3.9 能力开关（评审修正后）

- **服务端为权威门禁**：inspect / compose 请求带 `terminalId`，服务端调用既有 `TerminalCapabilitiesService.assertUserTaskAllowed(terminalId, 'signature_stamp')`——与 `/print/jobs` 对 `document_print` 的既有断言同模式。这是对初稿"不做服务端能力断言"的推翻：评审核实 Kiosk `getConfiguredCapabilities()` 在请求失败/mock/未配置终端时返回空映射，页面回落卡片硬编码默认值；一旦卡片默认翻为 `available:true`，纯前端开关即 **fail-open**。服务端断言使能力关停在任何前端状态下都真实生效。
- Kiosk 卡片 `sign` → `signature_stamp` 能力键映射已存在（`PrintScanHomePage.tsx` `CARD_CAPABILITY_KEY`），卡片 `available` 改 true，前端开关继续作为 UX 层（隐藏入口），不再承担安全职责。
- Admin 侧：仅使用「打印扫描运维 → 设备能力」既有配置页把 `signature_stamp` 配为 `available`（评审修正：`apps/admin/src/routes/print-scan/index.tsx` 任务中心 `TASK_TYPE_TABS` 里的 `signature_stamp implemented:false` 属于任务类型 Tab——本设计不创建 SignTask 模型，该 Tab **保持 false 不动**）。

### 3.10 审计

- 同步**尽力**写审计（评审修正表述：`AuditService.write()` 失败仅记日志不阻塞业务，故为 best-effort，不承诺"每次必有"；写失败会产生错误日志供运维告警）。
- action 命名对齐现有前缀风格：`print_sign.compose`（同域参照 `print_conversion.images_to_pdf`）。
- 记录字段：会员 id 或游客标记、`terminalId`、requestId、document/stamp fileId、placement、输出 fileId、`authorizationConfirmed` 与授权确认文案版本号。**不记录文件正文、图片像素数据或签名串**。

## 四、与打印确认页的衔接

compose 端点不创建 `PrintTask` / 订单 / `paymentSessionToken`。「去打印」跳转 `/print/confirm` 传递（同格式转换）：

```text
file: { name, size, pages, fileId, fileUrl = printFileUrl, fileMd5, mimeType: 'application/pdf' }
params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' })
source: 'document'
```

同时写入 `printMaterialSession` 防刷新丢失。后端 `/print/jobs` 照常自行验签 URL、自行读内容数页计价，不信前端——因此 §3.4-9 的 `useObjectStreams:false` + §十 的真实建单集成断言是本功能可打印性的关键保障。

## 五、前端改动范围

- 新页面 `apps/kiosk/src/pages/print-scan/SignStampPage.tsx`（路由 `/print-scan/sign`）：文档选择 → 图片上传 → 位置选择（页码 + 九宫格 + 大小档）→ 授权确认勾选 → 结果预览（iframe）+ 三动作。步骤态页面内管理；扫码面板打开期间 `useBusyLock` 防待机屏（同 ConvertImagesPage）；凭证/登录态过期的针对性提示（§二 异常路径）。
- `PrintScanFeatureInfoPage.tsx`：`FeatureKey` 收窄为 `'id-photo'`，删除 sign 分支。
- `PrintScanHomePage.tsx`：sign 卡片 `available:false → true`，`to: '/print-scan/sign'`；描述文案收窄为"在 PDF 上叠加签名/印章图片（版式合成）"。
- **不改 `HomePage.tsx`**（评审修正：首页"打印扫描"分组本就没有签名盖章磁贴，入口稳定规则禁止新增）。
- `MyDocumentsPage.tsx`：符合 §3.3 白名单的 PDF 文档新增「签名盖章」动作（复用打印动作的 `fetchAccessUrl` 模式）。
- `apps/kiosk/src/services/files/filesApi.ts`：`kioskUploadFile` 支持传入 purpose（签名图片通道用 `signature_image`；默认值保持 `print_doc` 不影响既有调用）。
- 新增 `apps/kiosk/src/services/api/printSign.ts`（独立 API 模块，类型引自 `packages/shared/src/types/printSign.ts`）。
- 触控规则：页码/九宫格/大小档全部为大按钮，主操作 ≥56px、可点击区域 ≥48px。

## 六、复用与不复用

**复用**：`UploadSessionQrPanel` + `PhoneUploadPage`（扫码上传；purpose 参数化）、`kioskUploadFile()`（增加 purpose 入参）、`StorageService.getObject()`、`FilesService.upload()`（含魔数嗅探）、`signFileUrl()`、`countPdfPages()`（输出兼容性校验）、`image-dimensions.util.ts`、Redis `setNxEx()`、`makePrintParams()`、`PrintPreviewPage` 的 iframe PDF 预览**模式**（`FilePreviewPanel` 是页面私有组件，只复用做法不抽组件）、`fetchAccessUrl()`、`useBusyLock`、`TerminalCapabilitiesService.assertUserTaskAllowed()`。

**不复用/不引入**：pdfkit（无修改已有 PDF 能力）、unpdf（已有依赖但只读解析，不能叠图；作为二期"可靠页数解析替换 countPdfPages"的候选记录）、sharp 等图像处理库、pdfjs-dist（二期拖放定位再评估）、Terminal Agent 的 `imageToPdf()`。

## 七、数据归属与保存策略

- **合成 PDF**：`FileObject(purpose=print_doc, assetCategory=derived, sourceFileId=document.fileId, sensitiveLevel=继承较高者)`；登录会员自动进「我的文档」（`listDocuments` 无 purpose 过滤，天然收录），可预览/下载/再打印/延长保存/删除；打印后进「打印订单」。保存期限零特例：`print_doc` 默认 `system_short`（约 24h），会员延长保存沿用「我的文档」现有用户主动确认机制。与 `user-data-flow-matrix.md` §3.4 口径一致，实现后需同步该矩阵行与 `current-progress.md`。
- **签名/印章图片 = 新 `FilePurpose` `signature_image`**（评审 High 项修正；原方案复用 `print_doc` 会使签名图默认 `normal` 敏感等级、可被会员延期到 3–6 个月，与"敏感个人材料"定位矛盾）：
  - `PURPOSE_POLICY`：mimes 仅 `image/png`/`image/jpeg`，maxBytes 10MB；
  - `DEFAULT_SENSITIVE_BY_PURPOSE`：`highly_sensitive`；
  - 留存：固定 `system_short`（约 24h），**锁定不可延期**（不进会员可选保存策略白名单）；
  - 「我的文档」列表**排除** `signature_image`（签名图不是"文档"，不提供预览/延期/再打印入口；用户重签重新上传，符合短期即弃定位）；
  - 上传通道：`kiosk-upload` 与 upload-session 均放行该 purpose，upload-session **confirm 回签 `file.fileUrl` 的 purpose 白名单**（现仅 `print_doc`）需加入 `signature_image`（否则游客扫码上传的签名图拿不到凭证）。
  - 不因幂等重放需要而主动删除源文件（TTL 自然过期）。
- 「重新选位置」产生的多份派生文件按 `print_doc` 短期策略自然清理；UI 明示会产生多个版本（§二-8）。

## 八、合规边界

- 定位红线：**图形排版工具**，输出物 = 打印前的版式合成预览。页面与结果页均展示 `COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE`（常量已存在）。
- 文案白名单：「生成合成 PDF」「签章合成」「版式合成」；**禁止**「签署」「已签署」「电子签名完成」「盖章生效」等暗示法律效力的表述。
- **不内置任何印章图库、印章模板或印章生成器**——只接受用户自行上传的图片。系统不帮助用户"制造"印章，只做用户自有图片的版式排布。
- **授权确认**：生成前必须勾选"本人拥有该签名/印章图片的使用授权"（§二-6），确认动作 + 文案版本进审计；页面另有警示：伪造、变造印章或冒用他人签名属违法行为，责任由使用者自负。
- **数字签名 PDF**：检测到已有数字签名域直接拒绝（`SIGN_DOC_HAS_DIGITAL_SIGNATURE`），提示"该文件含数字签名，叠加图片会使原签名失效，本功能不处理此类文件"；对无法检测的冷门形态，免责声明覆盖"合成会改变文件字节，可能使文件上任何既有数字签名失效"。
- **不宣称"净化/安全清洗"**：pdf-lib 合成保留原 PDF 的表单、附件、动作等结构（不保证其交互外观/行为），合成 ≠ 内容消毒；预览 iframe 沿用现有同源无 sandbox 模式（与 `PrintPreviewPage` 一致，用户自有文件风险有限，如实记录不加粉饰）。
- 每次合成尽力写审计（§3.10），可追溯。
- 不触碰招聘平台合规红线（纯文件工具服务）；不伪造能力：预览必须来自真实合成产物，合成失败不得展示"已完成"。

## 九、已知遗留与二期

**二期候选**：触屏拖放定位（pdfjs-dist 前端渲染，评估包体与触控精度）、触屏手写板（canvas 组件或 signature_pad）、图片白底转透明与 EXIF 方向归一化（需图像处理依赖）、骑缝章/批量页盖章、用 unpdf 替换 `countPdfPages()` 正则计页（可靠解析对象流 PDF，属打印链路级改动需独立评估）。

**独立跟进建议（不在本设计范围）**：print-conversion / print-jobs / print-page-count 三处私有 HMAC URL 解析器收敛到 §3.1 的公共函数；print-conversion 的幂等锁裸 `DEL` 竞态同样存在，可随本模块的 compare-and-delete 模式回补。

**沿用既有遗留**：`FilesService.upload()` "先写存储后建记录"的孤儿对象隐患（预先存在，非本功能引入）。

## 十、验证计划

新增 `verify:print-sign`（参照 `verify-print-conversion.ts` 的 Fake Prisma/Storage/Redis 模式，接入双 CI），覆盖：

- 归属：会员访问他人文件 / 游客凭证与 fileId 不匹配 / 过期凭证 → `SIGN_SOURCE_NOT_FOUND`
- 类型与白名单：document 非 PDF、purpose 白名单外（含会员 `temp` PDF）、stamp 非 PNG/JPG、stamp purpose 非 `signature_image` → 对应错误码
- 文档形态（用真实 PDF 夹具，不能只用手搓字节）：加密 PDF、损坏 xref、含数字签名域、对象流 PDF 输入、`/Rotate 90/270` 页、带 CropBox 页 → 对应错误码或几何断言
- 限制：超页数/大小、图片超大小/像素、页码越界 → 对应错误码
- 成功合成：输出页数 = 输入页数、`assetCategory='derived'`、`sourceFileId=document.fileId`、`sensitiveLevel` 继承较高者、filename 已净化、`printFileUrl` 为内部 HMAC 格式
- 几何：九宫格 9 位置 × 3 档大小坐标断言（含细长图等比反算、旋转页坐标变换分支）
- **打印链路兼容（评审 High 项）**：真实 pdf-lib 输出交给 `countPdfPages()` 断言页数可数且正确；**防回退断言**：源码级或行为级确认 `save` 使用 `useObjectStreams:false`（如断言输出 buffer 含明文 `/Type /Page` 计数 = 页数）
- 幂等：同 key 重放返回同一输出且重验源归属 + 输出存活；输出被删后重放 → 重新生成或明确错误；同 key 不同指纹 → `IDEMPOTENCY_KEY_REUSED`；处理中 → `SIGN_IN_PROGRESS`；失败 compare-and-delete 释放锁不误删他人锁
- 能力断言：`signature_stamp` 未配置（strict 模式）/ 非 available → 既有能力错误码
- 「再加一处」：合成产物的 printFileUrl 作为下一轮 document 凭证可通过校验
- 授权确认：`authorizationConfirmed` 非 true → 拒绝

集成级（实现阶段执行）：真实 pdf-lib 输出走一次 `PrintPageCountService.resolveBillablePages()` + `/print/jobs` 建单（本地 verify 或手动脚本），确认可建单、页数计费正确、HMAC 重签有效。

Kiosk mock 模式浏览器走查：两入口（服务中心卡片/我的文档动作）→ 双通道选文档 → inspect 页数 → 上传图片 → 选位 → 授权勾选 → 合成 → iframe 预览 → 去打印携带正确 state；`useBusyLock` 生效；凭证过期提示路径。

API / Kiosk / shared typecheck + lint；`verify:print-conversion`、`verify:cos:files`、`verify:upload-sessions` 等既有门禁回归确认零影响（upload-session confirm 白名单与 `kioskUploadFile` purpose 参数化会触碰其代码路径）。

## 十一、实施文件预算（评审采纳，供 writing-plans 阶段核对）

| 类别 | 文件 |
|---|---|
| 新增（后端） | `services/api/src/print-sign/`（controller/service/dto/types/module 5 文件）、`services/api/scripts/verify-print-sign.ts` |
| 新增（共享/前端） | `packages/shared/src/types/printSign.ts`、`apps/kiosk/src/services/api/printSign.ts`、`apps/kiosk/src/pages/print-scan/SignStampPage.tsx` |
| 修改（后端） | `services/api/src/app.module.ts`（模块注册）、`services/api/package.json` + `pnpm-lock.yaml`（pdf-lib）、`services/api/src/files/file-validation.ts`（`signature_image` policy + 敏感等级）、`services/api/src/files/retention-policy.ts`（锁定策略）、`services/api/src/files/signing.ts`（公共解析函数）、`services/api/src/upload-sessions/*`（confirm 回签白名单）、`services/api/src/member-assets/member-assets.service.ts`（listDocuments 排除 signature_image）、`services/api/package.json` scripts + `.github/workflows/ci.yml`（verify:print-sign 进双 CI） |
| 修改（共享/前端） | `packages/shared/src/types/file.ts`（FilePurpose + printFileUrl 注释）、shared index 导出、`apps/kiosk/src/routes/index.tsx`（路由）、`PrintScanHomePage.tsx`、`PrintScanFeatureInfoPage.tsx`、`MyDocumentsPage.tsx`、`apps/kiosk/src/services/files/filesApi.ts` |
| 文档 | `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`、`docs/product/user-data-flow-matrix.md` §3.4 |

超出此预算的改动（尤其触碰打印链路、既有三处 URL 解析器重构、Prisma schema）需先回到设计层重新确认。

## 十二、评审吸收记录（2026-07-12）

外部 Codex（Backend Architect，只读）评审结论：无 Critical 级既有漏洞；4 项 High 级设计阻塞 + 多项事实修正，处理如下：

**High 级阻塞（全部采纳）**：
1. 能力开关 fail-open → §3.9 改为服务端 `assertUserTaskAllowed` 权威断言（推翻初稿"不做服务端能力断言"）。
2. 签名图片留存与敏感性矛盾 → §七 新增 `signature_image` purpose（highly_sensitive + 锁定短期 + 不进我的文档；推翻初稿"不新增 FilePurpose"）；合成产物 sensitiveLevel 继承较高者（§3.5）。
3. pdf-lib 产物与 `countPdfPages()` 计费器兼容性 → §3.4-9 硬性 `useObjectStreams:false` + 输出可计费双保险校验 + §十 防回退与真实建单断言。
4. 已有数字签名 PDF 失效风险 → §3.4-3 检测签名域即拒绝 + §八 免责声明兜底。

**事实修正（全部采纳）**：unpdf 已存在（§一依赖事实）；首页无签名盖章磁贴、不新增（§二/§五）；Admin `implemented` 是任务中心 Tab、保持 false（§3.9）；DTO 错误走全局 `VALIDATION_FAILED`（§3.8）；purpose 白名单"全覆盖"表述收敛 + 前后端同白名单（§3.3）；`%PDF` 四字节口径（§3.4-2）；iframe 复用模式而非组件（§六）。

**Medium/Low（采纳进设计）**：审计 best-effort 表述与增强字段、授权确认勾选、幂等 owner-token compare-and-delete、Idempotency-Key 格式约束、缓存命中验输出存活、旋转页/CropBox 几何、EXIF/CMYK 处理边界、解析 DoS 超时与并发上限、会员+IP 双维限流、文件名净化、凭证/登录态过期 UX、shared 契约文件、HMAC 解析公共函数、错误码拆分、实施文件预算、真实 PDF 测试夹具清单。

**记录为独立跟进（不进本 MVP）**：既有三处 HMAC 解析器收敛重构、print-conversion 幂等锁竞态回补、unpdf 替换计费计页。

---

本文档为 brainstorm 阶段最终设计（已含外部评审吸收）。下一步：用户审阅本文档 → 确认后转入 `writing-plans` 技能产出实现计划。**设计获用户确认前不写任何实现代码。**
