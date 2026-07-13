# 签名盖章（图形排版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户自己的 PDF 指定页、九宫格预设位置叠加一张签名/印章图片，pdf-lib 合成新 PDF 后进既有 `/print/confirm` 打印链路（纯图形排版，非 CA 电子签）。

**Architecture:** 新增后端 `print-sign` 模块（照搬 `print-conversion` 的归属校验/幂等/凭证模式，外加服务端能力断言、owner-token 幂等锁、pdf-lib 合成几何）；files 层新增 `signature_image` purpose（高敏 + 锁定短期留存）；Kiosk 新增 `SignStampPage` 四步流（选文档 → 传图 → 选位 → 预览），入口 = `/print-scan` 服务中心卡片 + 「我的文档」动作（**不新增首页磁贴**）。

**Tech Stack:** NestJS + Prisma + Redis + pdf-lib（新依赖，唯一）+ React/Vite Kiosk。

**设计文档（SSOT）：** `docs/superpowers/specs/2026-07-12-sign-stamp-design.md`（已经外部 Codex 评审吸收、用户确认）。计划与设计冲突时以设计为准并回报。

**分支：** 全部工作在 `feature/sign-stamp-design`（已存在，含设计文档 commit）。

## 关键技术前提（写计划前已核实，非假设）

- `pdf-lib` 不在仓库任何 package.json（需新装）；`pdfkit@0.15.2` 无法修改已有 PDF；`unpdf@1.6.2` 已存在但只读。
- `RedisService` 已有 `setNxEx / setEx / get / del / incrWithTtl / getAndDelIfEquals`（最后一个是 Lua 原子 compare-and-delete，`services/api/src/common/redis/redis.service.ts:27`）——幂等锁 owner-token 释放直接用它，**不需要新写 Lua**。
- `TerminalCapabilitiesService` 由 `TerminalsModule` 导出（`services/api/src/terminals/terminals.module.ts:20`）；`assertUserTaskAllowed(terminalId, key)` 未配置行按 `PRINT_SCAN_CAPABILITY_MODE`（managed 放行 / strict 拒 `CAPABILITY_NOT_CONFIGURED`），非 available 抛 `CAPABILITY_UNAVAILABLE`。
- 打印计费器 `countPdfPages()`（`services/api/src/files/file-page-count.util.ts`）只数明文 `/Type /Page` → pdf-lib 必须 `save({ useObjectStreams: false })`。
- `SUPPORTED_UPLOAD_SESSION_PURPOSES = Set(['resume_upload','print_doc'])`（`upload-sessions.service.ts:99`）；confirm 仅 `purpose==='print_doc'` 回签 `fileUrl`（`:259`）。
- Kiosk `kioskUploadFile(file, purpose, token)` 带 purpose 的版本已存在于 `apps/kiosk/src/services/api/files.ts:14`（`services/files/filesApi.ts` 只是固定 print_doc 的薄封装，**无需改**）。
- Kiosk terminalId 取法：`(import.meta.env['VITE_TERMINAL_ID'] ?? '').trim()`，缺失即报错（`apps/kiosk/src/services/print/printJobsApi.ts:75-78`）。
- iframe PDF 预览直接 `src={相对路径 fileUrl}`（`PrintPreviewPage.tsx:200-204` 先例）。
- 首页 `HomePage.tsx` 打印扫描组**没有**签名盖章磁贴（`:318` 附近实测）——不新增。

---

## Task 1: 安装 pdf-lib

**Files:**
- Modify: `services/api/package.json`（dependencies）
- Modify: `pnpm-lock.yaml`（自动）

- [ ] **Step 1: 安装**

```bash
pnpm --filter @ai-job-print/api add pdf-lib@^1.17.1
```

- [ ] **Step 2: 冒烟验证（REPL 级，确认 CJS 可用）**

```bash
node -e "const {PDFDocument}=require('./services/api/node_modules/pdf-lib'); PDFDocument.create().then(d=>d.save({useObjectStreams:false})).then(b=>console.log('pdf-lib ok, bytes:',b.length))"
```
Expected: `pdf-lib ok, bytes: <数百>`

- [ ] **Step 3: Commit**

```bash
git add services/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add pdf-lib for sign-stamp PDF overlay"
```

---

## Task 2: Shared 类型（printSign.ts + FilePurpose 扩展）

**Files:**
- Create: `packages/shared/src/types/printSign.ts`
- Modify: `packages/shared/src/types/file.ts:18-33`（FilePurpose union）
- Modify: `packages/shared/src/types/file.ts:124` 附近（printFileUrl 注释）
- Modify: `packages/shared/src/index.ts`（barrel export，找到 printConversion 的导出行照样加一行）
- Modify: `packages/shared/src/types/uploadSession.ts:29-30`（fileUrl 注释）

- [ ] **Step 1: 创建 printSign.ts**

```typescript
// packages/shared/src/types/printSign.ts
//
// 签名盖章（图形排版）契约 SSOT。后端在
// services/api/src/print-sign/print-sign.types.ts 保留本地副本（原因见
// print-conversion.types.ts 顶部注释：API 是 commonjs，shared 是 ESM-only）。
// 任何字段变更必须同时改两处。

export type SignStampPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export type SignStampSize = 'small' | 'medium' | 'large'

export interface SignStampSource {
  fileId: string
  /** 上传/扫码确认后返回的内部 HMAC 签名 URL，作为访问凭证；不用于实际读取。会员路径以登录态归属为准、不校验此 URL（与 print-conversion 同语义）。 */
  fileAccessUrl: string
}

export interface SignStampPlacement {
  /** 1-based 页码 */
  page: number
  position: SignStampPosition
  size: SignStampSize
}

export interface SignInspectRequest {
  terminalId: string
  document: SignStampSource
}

export interface SignInspectResponse {
  pages: number
}

export interface SignComposeRequest {
  terminalId: string
  document: SignStampSource
  stamp: SignStampSource
  placement: SignStampPlacement
  /** 用户勾选"本人拥有该签名/印章图片的使用授权"；必须为 true */
  authorizationConfirmed: boolean
}

export interface SignComposeResponse {
  fileId: string
  /** 内部 HMAC 打印链路 URL（30 分钟 TTL），非 COS 预签名；可作为下一轮 document.fileAccessUrl 凭证（"再加一处"循环） */
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
}

export type SignComposeErrorCode =
  | 'SIGN_SOURCE_NOT_FOUND'
  | 'SIGN_DOC_TYPE_UNSUPPORTED'
  | 'SIGN_DOC_UNSUPPORTED'
  | 'SIGN_DOC_HAS_DIGITAL_SIGNATURE'
  | 'SIGN_DOC_TOO_LARGE'
  | 'SIGN_DOC_TOO_MANY_PAGES'
  | 'SIGN_STAMP_TYPE_UNSUPPORTED'
  | 'SIGN_STAMP_UNSUPPORTED'
  | 'SIGN_STAMP_TOO_LARGE'
  | 'SIGN_PLACEMENT_INVALID'
  | 'SIGN_OUTPUT_TOO_LARGE'
  | 'SIGN_IN_PROGRESS'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SIGN_FAILED'
```

- [ ] **Step 2: FilePurpose union 加 `signature_image`**

在 `packages/shared/src/types/file.ts` 的 `FilePurpose` union（`temp` 行之后）加：

```typescript
  | 'signature_image'      // 签名/印章图片(高敏,锁定系统短期,不进"我的文档")
```

- [ ] **Step 3: printFileUrl 注释扩展**

`packages/shared/src/types/file.ts` `FileAccessUrlResponse.printFileUrl` 的注释改为：

```typescript
  /** 系统 HMAC content URL，供 /print/jobs 与签章类内部文件变换端点（/print/sign/*）作访问凭证；url 只用于预览/下载。 */
```

- [ ] **Step 4: uploadSession.ts fileUrl 注释更新**

`packages/shared/src/types/uploadSession.ts:29` 注释改为：

```typescript
  /** 仅 print_doc / signature_image 用途在 confirm 时携带:本系统签名内容 URL,供打印任务/签章合成创建使用。 */
```

- [ ] **Step 5: barrel export**

在 `packages/shared/src/index.ts` 中 `export * from './types/printConversion'` 旁加：

```typescript
export * from './types/printSign'
```

- [ ] **Step 6: typecheck**

```bash
pnpm --filter @ai-job-print/shared typecheck
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/printSign.ts packages/shared/src/types/file.ts packages/shared/src/types/uploadSession.ts packages/shared/src/index.ts
git commit -m "feat(shared): sign-stamp contract types + signature_image purpose"
```

---

## Task 3: files 层 signature_image 策略（后端）

**Files:**
- Modify: `services/api/src/files/file.types.ts:17`（FilePurpose 后端副本）
- Modify: `services/api/src/files/file-validation.ts:50-70`（PURPOSE_POLICY）与 `:76-90`（DEFAULT_SENSITIVE_BY_PURPOSE）
- Modify: `services/api/src/files/retention-policy.ts`（allowedPoliciesForFile + assertCanSetRetention）
- Modify: `services/api/src/member-assets/member-assets.service.ts:80`（listDocuments 排除）

- [ ] **Step 1: 后端 FilePurpose 副本加枚举**

`services/api/src/files/file.types.ts` 的 `FilePurpose` union（与 shared 同位置）加：

```typescript
  | 'signature_image'      // 签名/印章图片(高敏,锁定系统短期,不进"我的文档")
```

- [ ] **Step 2: PURPOSE_POLICY + 默认敏感等级**

`file-validation.ts` `PURPOSE_POLICY` 的 `temp` 行后加：

```typescript
  // 签名/印章图片:仅供签章合成读取,高敏、系统短期、锁定不可延期(见 retention-policy.ts)
  signature_image: { mimes: ['image/jpeg', 'image/png'], maxBytes: 10 * MB },
```

`DEFAULT_SENSITIVE_BY_PURPOSE` 的 `temp: 'sensitive',` 行后加：

```typescript
  signature_image: 'highly_sensitive',
```

- [ ] **Step 3: retention-policy 锁定**

`retention-policy.ts` `allowedPoliciesForFile` 函数体开头（`id_scan` 判断之后）加：

```typescript
  if (input.purpose === 'signature_image') return ['system_short']
```

`assertCanSetRetention` 中 `id_scan` 的锁定判断之后加：

```typescript
  if (input.purpose === 'signature_image' && input.policy !== 'system_short') {
    throw new RetentionPolicyError('RETENTION_SIGNATURE_IMAGE_LOCKED', '签名/印章图片仅支持系统短期保存')
  }
```

（`MEMBER_DEFAULT_PURPOSES` 不含 signature_image → 上传默认自动落 `system_short`，无需改 `defaultRetentionForUpload`。）

- [ ] **Step 4: listDocuments 排除签名图片**

`member-assets.service.ts` `listDocuments` 中：

```typescript
    const where = { ...isVisibleMemberFileWhere(endUserId, new Date()), purpose: { not: 'signature_image' } }
```

注意 `count` 与 `findMany` 共用同一个 `where` 变量，只改这一处定义即可。**不要改 `isVisibleMemberFileWhere` 本身**（它被留存治理多处复用）。

- [ ] **Step 5: typecheck**

```bash
pnpm --filter @ai-job-print/api typecheck
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/api/src/files/file.types.ts services/api/src/files/file-validation.ts services/api/src/files/retention-policy.ts services/api/src/member-assets/member-assets.service.ts
git commit -m "feat(api): signature_image purpose — highly sensitive, locked short retention, hidden from my-documents"
```

---

## Task 4: upload-sessions 支持 signature_image

**Files:**
- Modify: `services/api/src/upload-sessions/upload-sessions.service.ts:49-50, :99, :259`

- [ ] **Step 1: 三处小改**

`:99` 白名单：

```typescript
const SUPPORTED_UPLOAD_SESSION_PURPOSES: ReadonlySet<FilePurpose> = new Set(['resume_upload', 'print_doc', 'signature_image'])
```

`:259` confirm 回签条件（原 `if (record.purpose === 'print_doc')`）：

```typescript
    if (record.purpose === 'print_doc' || record.purpose === 'signature_image') {
```

`:49-50` 的 `fileUrl` 字段注释改为：

```typescript
  /** 仅 print_doc / signature_image 用途在 confirm 时签发：本系统 HMAC 签名内容 URL，供打印任务/签章合成使用。 */
```

- [ ] **Step 2: typecheck + 既有门禁回归**

```bash
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api verify:upload-sessions
```
Expected: 两者 PASS（回归确认白名单扩展不破坏既有断言）

- [ ] **Step 3: Commit**

```bash
git add services/api/src/upload-sessions/upload-sessions.service.ts
git commit -m "feat(api): allow signature_image purpose in upload sessions (confirm signs fileUrl)"
```

---

## Task 5: signing.ts 公共凭证解析函数

**Files:**
- Modify: `services/api/src/files/signing.ts`（文件末尾追加）

- [ ] **Step 1: 追加函数**

```typescript
/**
 * 解析并验签本系统内部 content URL（/files/:id/content?expires&sig）。
 * 返回 { fileId } 表示签名有效且未过期；null 表示格式非法/验签失败/已过期。
 * 供签章等"以 URL 为访问凭证"的内部文件变换端点使用；仅校验、不读取存储。
 * （print-conversion / print-jobs / print-page-count 各自的私有解析器收敛
 *   到本函数属独立重构任务，本次不动它们 —— 见 sign-stamp 设计 §九。）
 */
export function parseAndVerifySignedContentUrl(url: string): { fileId: string } | null {
  try {
    const parsed = new URL(url, 'http://internal.local')
    const match = parsed.pathname.match(/\/files\/([^/]+)\/content$/)
    const expires = parsed.searchParams.get('expires')
    const sig = parsed.searchParams.get('sig')
    if (!match || !expires || !sig) return null
    const fileId = match[1]!
    return verifyFileSignature(fileId, expires, sig) ? { fileId } : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: typecheck + Commit**

```bash
pnpm --filter @ai-job-print/api typecheck
git add services/api/src/files/signing.ts
git commit -m "feat(api): shared parseAndVerifySignedContentUrl helper in signing.ts"
```

---

## Task 6: print-sign 类型副本 + DTO + 几何模块

**Files:**
- Create: `services/api/src/print-sign/print-sign.types.ts`
- Create: `services/api/src/print-sign/print-sign.dto.ts`
- Create: `services/api/src/print-sign/print-sign-geometry.ts`

- [ ] **Step 1: 类型副本**

```typescript
// services/api/src/print-sign/print-sign.types.ts
/**
 * 签名盖章契约本地副本。
 * **契约源**：packages/shared/src/types/printSign.ts（原因与双改规则见
 * print-conversion.types.ts 顶部注释）。
 */

export type SignStampPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export const SIGN_STAMP_POSITIONS: readonly SignStampPosition[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

export type SignStampSize = 'small' | 'medium' | 'large'
export const SIGN_STAMP_SIZES: readonly SignStampSize[] = ['small', 'medium', 'large']

export interface SignStampSource {
  fileId: string
  fileAccessUrl: string
}

export interface SignStampPlacement {
  page: number
  position: SignStampPosition
  size: SignStampSize
}

export interface SignInspectResponse {
  pages: number
}

export interface SignComposeResponse {
  fileId: string
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
}
```

- [ ] **Step 2: DTO**

```typescript
// services/api/src/print-sign/print-sign.dto.ts
import { Equals, IsIn, IsInt, IsString, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import {
  SIGN_STAMP_POSITIONS,
  SIGN_STAMP_SIZES,
  type SignStampPosition,
  type SignStampSize,
} from './print-sign.types'

export class SignSourceDto {
  @IsString()
  fileId!: string

  @IsString()
  fileAccessUrl!: string
}

export class SignPlacementDto {
  @IsInt()
  @Min(1)
  page!: number

  @IsIn([...SIGN_STAMP_POSITIONS])
  position!: SignStampPosition

  @IsIn([...SIGN_STAMP_SIZES])
  size!: SignStampSize
}

export class SignInspectDto {
  @IsString()
  terminalId!: string

  @ValidateNested()
  @Type(() => SignSourceDto)
  document!: SignSourceDto
}

export class SignComposeDto {
  @IsString()
  terminalId!: string

  @ValidateNested()
  @Type(() => SignSourceDto)
  document!: SignSourceDto

  @ValidateNested()
  @Type(() => SignSourceDto)
  stamp!: SignSourceDto

  @ValidateNested()
  @Type(() => SignPlacementDto)
  placement!: SignPlacementDto

  @Equals(true)
  authorizationConfirmed!: boolean
}
```

- [ ] **Step 3: 几何模块（纯函数，verify 直接单测）**

```typescript
// services/api/src/print-sign/print-sign-geometry.ts
/**
 * 九宫格 → pdf-lib drawImage 参数换算。
 *
 * 关键概念："视觉空间" = 用户在预览/打印纸上看到的方向。PDF 页可带 /Rotate
 * 90/180/270（扫描件常见），此时 page.getSize()/getCropBox() 的用户空间坐标
 * 与视觉方向不一致，必须先在视觉空间算好位置，再逆映射回用户空间，并让
 * drawImage 以同角度 rotate，使图片在视觉上是正的。
 *
 * /Rotate 语义：显示时顺时针旋转页面；pdf-lib 的 rotate: degrees(n) 是把
 * 图片绕锚点逆时针转 n 度 —— 两者同角度值恰好抵消。
 *
 * 映射推导（X0/Y0/W/H = CropBox；vx/vy = 视觉空间中图片左下角目标点）：
 *   rot 0  : 用户(x,y) = (X0+vx,        Y0+vy)
 *   rot 90 : 视觉宽=H 高=W；user(x,y)→visual(y-Y0, X0+W-x)；
 *            锚点 x = X0+W-vy, y = Y0+vx（rotate 90 后图片占 x∈[x-h,x], y∈[y,y+w]）
 *   rot 180: 锚点 x = X0+W-vx, y = Y0+H-vy
 *   rot 270: 视觉宽=H 高=W；锚点 x = X0+vy, y = Y0+H-vx
 */
import type { SignStampPosition, SignStampSize } from './print-sign.types'

const SIZE_FACTOR: Record<SignStampSize, number> = { small: 0.15, medium: 0.25, large: 0.35 }
const MARGIN_RATIO = 0.04

const POSITION_GRID: Record<SignStampPosition, { col: 'left' | 'center' | 'right'; row: 'top' | 'middle' | 'bottom' }> = {
  'top-left': { col: 'left', row: 'top' },
  'top-center': { col: 'center', row: 'top' },
  'top-right': { col: 'right', row: 'top' },
  'middle-left': { col: 'left', row: 'middle' },
  center: { col: 'center', row: 'middle' },
  'middle-right': { col: 'right', row: 'middle' },
  'bottom-left': { col: 'left', row: 'bottom' },
  'bottom-center': { col: 'center', row: 'bottom' },
  'bottom-right': { col: 'right', row: 'bottom' },
}

export interface StampDrawParams {
  x: number
  y: number
  width: number
  height: number
  rotateDegrees: 0 | 90 | 180 | 270
}

export function normalizeRotation(rawAngle: number): 0 | 90 | 180 | 270 {
  const a = ((Math.round(rawAngle) % 360) + 360) % 360
  return a === 90 || a === 180 || a === 270 ? a : 0
}

export function computeStampDrawParams(args: {
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  rotation: 0 | 90 | 180 | 270
  imageWidth: number
  imageHeight: number
  position: SignStampPosition
  size: SignStampSize
}): StampDrawParams {
  const { cropX: X0, cropY: Y0, cropWidth: W, cropHeight: H, rotation, position, size } = args
  const rotated = rotation === 90 || rotation === 270
  const visualW = rotated ? H : W
  const visualH = rotated ? W : H

  const factor = SIZE_FACTOR[size]
  let w = visualW * factor
  let h = (w * args.imageHeight) / args.imageWidth
  if (h > visualH * factor) {
    // 细长/竖长图：改用高度约束反算宽度，保证不越出档位框
    h = visualH * factor
    w = (h * args.imageWidth) / args.imageHeight
  }

  const mX = visualW * MARGIN_RATIO
  const mY = visualH * MARGIN_RATIO
  const { col, row } = POSITION_GRID[position]
  const vx = col === 'left' ? mX : col === 'right' ? visualW - mX - w : (visualW - w) / 2
  const vy = row === 'bottom' ? mY : row === 'top' ? visualH - mY - h : (visualH - h) / 2

  let x: number
  let y: number
  switch (rotation) {
    case 0:
      x = X0 + vx
      y = Y0 + vy
      break
    case 90:
      x = X0 + W - vy
      y = Y0 + vx
      break
    case 180:
      x = X0 + W - vx
      y = Y0 + H - vy
      break
    case 270:
      x = X0 + vy
      y = Y0 + H - vx
      break
  }
  return { x, y, width: w, height: h, rotateDegrees: rotation }
}
```

- [ ] **Step 4: typecheck + Commit**

```bash
pnpm --filter @ai-job-print/api typecheck
git add services/api/src/print-sign/
git commit -m "feat(api): print-sign types, DTOs and rotation-aware 9-grid geometry"
```

---

## Task 7: 核心 Service

**Files:**
- Create: `services/api/src/print-sign/print-sign.service.ts`

- [ ] **Step 1: 写实现（完整文件）**

```typescript
// services/api/src/print-sign/print-sign.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { PDFDocument, PDFSignature, degrees } from 'pdf-lib'
import { createHash, randomBytes } from 'crypto'
import type { SignComposeResponse, SignInspectResponse, SignStampPlacement, SignStampSource } from './print-sign.types'
import { computeStampDrawParams, normalizeRotation } from './print-sign-geometry'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { RedisService } from '../common/redis/redis.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import { parseAndVerifySignedContentUrl, signFileUrl } from '../files/signing'
import { countPdfPages } from '../files/file-page-count.util'
import { sniffDeclaredMimeMismatch } from '../files/content-sniff'
import { readImageDimensions } from '../print-conversion/image-dimensions.util'
import type { FileSensitiveLevel } from '../files/file.types'

const MAX_DOC_BYTES = 15 * 1024 * 1024
const MAX_DOC_PAGES = 30
const MAX_STAMP_BYTES = 10 * 1024 * 1024
const MAX_STAMP_PIXELS = 25_000_000
const MAX_OUTPUT_BYTES = 15 * 1024 * 1024
const OUTPUT_URL_TTL_MS = 30 * 60 * 1000
const COMPOSE_TIMEOUT_MS = 10_000
const MAX_CONCURRENT_COMPOSE = 2
const IDEMPOTENCY_LOCK_TTL_SECONDS = 120
const IDEMPOTENCY_RESULT_TTL_SECONDS = 600
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,80}$/
const MEMBER_RATE_LIMIT_PER_MINUTE = 3

/** 授权确认文案版本：改 Kiosk 勾选文案时必须同步 bump，审计据此追溯用户当时看到的内容。 */
const AUTHORIZATION_NOTICE_VERSION = '2026-07-12.v1'

const DOC_PURPOSES_MEMBER = new Set(['print_doc', 'resume_upload', 'resume_scan', 'cover_letter'])
const DOC_PURPOSES_GUEST = new Set(['print_doc'])
const STAMP_MIMES = new Set(['image/jpeg', 'image/png'])
const SENSITIVE_ORDER: Record<FileSensitiveLevel, number> = { normal: 0, sensitive: 1, highly_sensitive: 2 }

class ComposeTimeoutError extends Error {}

interface IdempotencyState {
  status: 'in_progress' | 'completed'
  fingerprint: string
  ownerToken?: string
  fileId?: string
  fileMd5?: string
  sizeBytes?: number
  pages?: number
}

@Injectable()
export class PrintSignService {
  // 单实例并发合成上限（解析型 DoS 防线之一；超时是另一道，见 withTimeout）
  private inFlight = 0
  private readonly queue: Array<() => void> = []

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
    private readonly capabilities: TerminalCapabilitiesService,
  ) {}

  async inspect(args: { terminalId: string; document: SignStampSource; endUserId: string | null }): Promise<SignInspectResponse> {
    await this.capabilities.assertUserTaskAllowed(args.terminalId, 'signature_stamp')
    const record = await this.verifyDocumentSource(args.document, args.endUserId)
    const buffer = await this.storage.getObject(record.storageKey, record.bucket)
    try {
      const { pageCount } = await withTimeout(() => this.loadAndValidatePdf(buffer), COMPOSE_TIMEOUT_MS)
      return { pages: pageCount }
    } catch (err) {
      if (err instanceof ComposeTimeoutError) {
        throw new InternalServerErrorException({ error: { code: 'SIGN_FAILED', message: '文件处理超时，请换用更简单的文件重试' } })
      }
      throw err
    }
  }

  async compose(args: {
    terminalId: string
    document: SignStampSource
    stamp: SignStampSource
    placement: SignStampPlacement
    authorizationConfirmed: boolean
    endUserId: string | null
    idempotencyKey?: string | null
    requestId?: string | null
  }): Promise<SignComposeResponse> {
    const { endUserId, idempotencyKey } = args

    // DTO @Equals(true) 已在管道层拦截；service 层再防御一次（verify 脚本直调 service）
    if (args.authorizationConfirmed !== true) {
      throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请先确认签名/印章图片使用授权' } })
    }
    if (idempotencyKey != null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: 'Idempotency-Key 格式不合法' } })
    }

    await this.capabilities.assertUserTaskAllowed(args.terminalId, 'signature_stamp')

    // 会员维度频控（IP 维度由 @Throttle 承担；一体机共享出口 IP，两维并用）
    if (endUserId) {
      const count = await this.redis.incrWithTtl(`print-sign:rate:${endUserId}`, 60)
      if (count > MEMBER_RATE_LIMIT_PER_MINUTE) {
        throw new ConflictException({ error: { code: 'SIGN_IN_PROGRESS', message: '操作太频繁，请一分钟后再试' } })
      }
    }

    const idemKey = idempotencyKey ? `print-sign:idem:${endUserId ?? 'guest'}:${idempotencyKey}` : null
    const fingerprint = fingerprintRequest(args.document, args.stamp, args.placement)
    const ownerToken = randomBytes(16).toString('hex')

    if (idemKey) {
      const cached = await this.claimIdempotency(idemKey, args, fingerprint, ownerToken)
      if (cached) return cached
    }

    try {
      const result = await this.doCompose(args)
      if (idemKey) {
        await this.redis.setEx(
          idemKey,
          IDEMPOTENCY_RESULT_TTL_SECONDS,
          JSON.stringify({ status: 'completed', fingerprint, ...result }),
        )
      }
      return result
    } catch (err) {
      // owner-token compare-and-delete：只释放"自己那把"锁，不误删 120s 后他人接管的新锁/新结果
      if (idemKey) {
        await this.redis.getAndDelIfEquals(idemKey, JSON.stringify({ status: 'in_progress', fingerprint, ownerToken }))
      }
      throw err
    }
  }

  /** 返回非 null = 命中已完成结果（已重验源归属 + 输出存活）；抛异常 = 冲突；null = 本次持锁继续。 */
  private async claimIdempotency(
    idemKey: string,
    args: { document: SignStampSource; stamp: SignStampSource; endUserId: string | null },
    fingerprint: string,
    ownerToken: string,
  ): Promise<SignComposeResponse | null> {
    const lockPayload = JSON.stringify({ status: 'in_progress', fingerprint, ownerToken })

    const claimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
    if (claimed) return null

    let state = await this.readIdempotencyState(idemKey)
    if (!state) {
      const retryClaimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
      if (retryClaimed) return null
      state = await this.readIdempotencyState(idemKey)
      if (!state) return null
    }

    if (state.fingerprint !== fingerprint) {
      throw new ConflictException({
        error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该请求标识已用于另一次签章参数，请更换标识重试' },
      })
    }
    if (state.status === 'in_progress') {
      throw new ConflictException({ error: { code: 'SIGN_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' } })
    }

    // completed：重验"这次请求"对双源文件的访问权（防拿同 key+fileId 白嫖他人结果）
    await this.verifyDocumentSource(args.document, args.endUserId)
    await this.verifyStampSource(args.stamp, args.endUserId)

    // 输出存活校验：输出可能已被删除/清理 —— 直接重签会返回必 404 的 URL
    const output = await this.prisma.fileObject.findUnique({ where: { id: state.fileId! } })
    const now = new Date()
    const outputAlive =
      output !== null &&
      output.status === 'active' &&
      output.deletedAt === null &&
      (output.expiresAt === null || output.expiresAt > now)
    if (!outputAlive) {
      await this.redis.del(idemKey)
      const reclaimed = await this.redis.setNxEx(
        idemKey,
        JSON.stringify({ status: 'in_progress', fingerprint, ownerToken }),
        IDEMPOTENCY_LOCK_TTL_SECONDS,
      )
      if (!reclaimed) {
        throw new ConflictException({ error: { code: 'SIGN_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' } })
      }
      return null // 输出已失效：按新请求重新生成
    }

    const printSigned = signFileUrl(state.fileId!, OUTPUT_URL_TTL_MS)
    return {
      fileId: state.fileId!,
      printFileUrl: printSigned.url,
      fileMd5: state.fileMd5!,
      sizeBytes: state.sizeBytes!,
      pages: state.pages!,
    }
  }

  private async readIdempotencyState(idemKey: string): Promise<IdempotencyState | null> {
    const raw = await this.redis.get(idemKey)
    if (!raw) return null
    return parseIdempotencyState(raw)
  }

  /** 归属校验（与 print-conversion.verifySourceOwnership 同模型），外加 document 的类型/白名单校验。 */
  private async verifyDocumentSource(source: SignStampSource, endUserId: string | null) {
    const record = await this.verifyOwnership(source, endUserId)
    const purposeOk = (endUserId ? DOC_PURPOSES_MEMBER : DOC_PURPOSES_GUEST).has(record.purpose)
    if (record.mimeType !== 'application/pdf' || !purposeOk) {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_TYPE_UNSUPPORTED', message: '仅支持本人的 PDF 文档' } })
    }
    if (record.sizeBytes > MAX_DOC_BYTES) {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_TOO_LARGE', message: '文档大小超出限制（15MB）' } })
    }
    return record
  }

  private async verifyStampSource(source: SignStampSource, endUserId: string | null) {
    const record = await this.verifyOwnership(source, endUserId)
    if (!STAMP_MIMES.has(record.mimeType) || record.purpose !== 'signature_image') {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_TYPE_UNSUPPORTED', message: '签名/印章图片仅支持 JPG / PNG' } })
    }
    if (record.sizeBytes > MAX_STAMP_BYTES) {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_TOO_LARGE', message: '图片大小超出限制（10MB）' } })
    }
    return record
  }

  private async verifyOwnership(source: SignStampSource, endUserId: string | null) {
    const found = await this.prisma.fileObject.findUnique({ where: { id: source.fileId } })
    const notFound = () =>
      new NotFoundException({ error: { code: 'SIGN_SOURCE_NOT_FOUND', message: '文件不存在或已失效' } })
    if (!found) throw notFound()

    const now = new Date()
    const baseOk =
      found.status === 'active' && found.deletedAt === null && (found.expiresAt === null || found.expiresAt > now)
    if (!baseOk) throw notFound()

    const ownerOk = endUserId
      ? found.endUserId === endUserId && found.ownerType === 'user' && found.ownerId === endUserId
      : found.endUserId === null && found.ownerType === 'system' && found.ownerId === null
    if (!ownerOk) throw notFound()

    if (endUserId === null) {
      const capability = parseAndVerifySignedContentUrl(source.fileAccessUrl)
      if (!capability || capability.fileId !== source.fileId) throw notFound()
    }
    return found
  }

  private async doCompose(args: {
    terminalId: string
    document: SignStampSource
    stamp: SignStampSource
    placement: SignStampPlacement
    endUserId: string | null
    requestId?: string | null
  }): Promise<SignComposeResponse> {
    const { endUserId, placement } = args
    const docRecord = await this.verifyDocumentSource(args.document, endUserId)
    const stampRecord = await this.verifyStampSource(args.stamp, endUserId)

    // 顺序读取（禁止 Promise.all，同 print-conversion）
    const docBuffer = await this.storage.getObject(docRecord.storageKey, docRecord.bucket)
    if (!sniffDeclaredMimeMismatch(docBuffer, 'application/pdf').ok) {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_UNSUPPORTED', message: '文档内容与 PDF 格式不符' } })
    }
    const stampBuffer = await this.storage.getObject(stampRecord.storageKey, stampRecord.bucket)
    if (!sniffDeclaredMimeMismatch(stampBuffer, stampRecord.mimeType).ok) {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_UNSUPPORTED', message: '图片内容与声明格式不符' } })
    }
    const dims = readImageDimensions(stampBuffer, stampRecord.mimeType)
    if (!dims || dims.width <= 0 || dims.height <= 0) {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_UNSUPPORTED', message: '图片已损坏或无法解析' } })
    }
    if (dims.width * dims.height > MAX_STAMP_PIXELS) {
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_TOO_LARGE', message: '图片像素超出限制' } })
    }

    await this.acquireComposeSlot()
    let outputBuffer: Buffer
    let pageCount: number
    try {
      const composed = await withTimeout(
        () => this.overlayStamp(docBuffer, stampBuffer, stampRecord.mimeType, dims, placement),
        COMPOSE_TIMEOUT_MS,
      )
      outputBuffer = composed.outputBuffer
      pageCount = composed.pageCount
    } catch (err) {
      if (err instanceof ComposeTimeoutError) {
        throw new InternalServerErrorException({ error: { code: 'SIGN_FAILED', message: '文件处理超时，请换用更简单的文件重试' } })
      }
      throw err
    } finally {
      this.releaseComposeSlot()
    }

    // 输出双保险：叠图不增删页 + 现有打印计费器（明文 /Type /Page 扫描）必须能数出同样页数。
    // useObjectStreams:false 回退会在这里立刻炸掉（countPdfPages 返回 null ≠ pageCount）。
    if (countPdfPages(outputBuffer) !== pageCount) {
      throw new InternalServerErrorException({ error: { code: 'SIGN_FAILED', message: '合成校验失败，请重试' } })
    }
    if (outputBuffer.length > MAX_OUTPUT_BYTES) {
      throw new BadRequestException({ error: { code: 'SIGN_OUTPUT_TOO_LARGE', message: '合成后的 PDF 超出大小限制' } })
    }

    const outLevel = maxSensitiveLevel(docRecord.sensitiveLevel as FileSensitiveLevel, 'sensitive')
    const uploaded = await this.files.upload({
      buffer: outputBuffer,
      filename: `${sanitizeBaseName(docRecord.filename)}-签章合成.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      sensitiveLevel: outLevel,
      uploaderId: null,
      endUserId: endUserId ?? undefined,
      assetCategory: 'derived',
      sourceFileId: args.document.fileId,
      createdBy: endUserId,
    })

    const printSigned = signFileUrl(uploaded.fileId, OUTPUT_URL_TTL_MS)

    await this.audit.write({
      actorId: endUserId,
      actorRole: endUserId ? 'member' : 'system',
      action: 'print_sign.compose',
      targetType: 'file',
      targetId: uploaded.fileId,
      payload: {
        terminalId: args.terminalId,
        requestId: args.requestId ?? null,
        documentFileId: args.document.fileId,
        stampFileId: args.stamp.fileId,
        placement,
        authorizationConfirmed: true,
        authorizationNoticeVersion: AUTHORIZATION_NOTICE_VERSION,
      },
    })

    return {
      fileId: uploaded.fileId,
      printFileUrl: printSigned.url,
      fileMd5: uploaded.sha256,
      sizeBytes: uploaded.sizeBytes,
      pages: pageCount,
    }
  }

  /** pdf-lib 加载校验 + 叠图 + 保存。加载失败（加密/损坏）→ SIGN_DOC_UNSUPPORTED。 */
  private async loadAndValidatePdf(buffer: Buffer): Promise<{ doc: PDFDocument; pageCount: number }> {
    let doc: PDFDocument
    try {
      doc = await PDFDocument.load(buffer) // 不传 ignoreEncryption：加密文档明确拒绝
    } catch {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_UNSUPPORTED', message: '文档已加密、损坏或格式不受支持' } })
    }
    if (hasDigitalSignatureField(doc)) {
      throw new BadRequestException({
        error: {
          code: 'SIGN_DOC_HAS_DIGITAL_SIGNATURE',
          message: '该文件含数字签名，叠加图片会使原签名失效，本功能不处理此类文件',
        },
      })
    }
    const pageCount = doc.getPageCount()
    if (pageCount < 1 || pageCount > MAX_DOC_PAGES) {
      throw new BadRequestException({ error: { code: 'SIGN_DOC_TOO_MANY_PAGES', message: `仅支持 1–${MAX_DOC_PAGES} 页的文档` } })
    }
    return { doc, pageCount }
  }

  private async overlayStamp(
    docBuffer: Buffer,
    stampBuffer: Buffer,
    stampMime: string,
    dims: { width: number; height: number },
    placement: SignStampPlacement,
  ): Promise<{ outputBuffer: Buffer; pageCount: number }> {
    const { doc, pageCount } = await this.loadAndValidatePdf(docBuffer)
    if (placement.page < 1 || placement.page > pageCount) {
      throw new BadRequestException({ error: { code: 'SIGN_PLACEMENT_INVALID', message: '页码超出文档范围' } })
    }

    let image
    try {
      image = stampMime === 'image/png' ? await doc.embedPng(stampBuffer) : await doc.embedJpg(stampBuffer)
    } catch {
      // CMYK JPEG 等 pdf-lib 不支持的编码变体：fail-closed
      throw new BadRequestException({ error: { code: 'SIGN_STAMP_UNSUPPORTED', message: '该图片编码暂不支持，请转存为普通 PNG/JPG 后重试' } })
    }

    const page = doc.getPage(placement.page - 1)
    const crop = page.getCropBox()
    const rotation = normalizeRotation(page.getRotation().angle)
    const draw = computeStampDrawParams({
      cropX: crop.x,
      cropY: crop.y,
      cropWidth: crop.width,
      cropHeight: crop.height,
      rotation,
      imageWidth: dims.width,
      imageHeight: dims.height,
      position: placement.position,
      size: placement.size,
    })
    page.drawImage(image, {
      x: draw.x,
      y: draw.y,
      width: draw.width,
      height: draw.height,
      rotate: degrees(draw.rotateDegrees),
    })

    // useObjectStreams:false 是硬性要求（打印计费器只数明文 /Type /Page）—— 勿"优化"
    const saved = await doc.save({ useObjectStreams: false })
    return { outputBuffer: Buffer.from(saved), pageCount }
  }

  private async acquireComposeSlot(): Promise<void> {
    if (this.inFlight < MAX_CONCURRENT_COMPOSE) {
      this.inFlight += 1
      return
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.inFlight += 1
  }

  private releaseComposeSlot(): void {
    this.inFlight -= 1
    const next = this.queue.shift()
    if (next) next()
  }
}

function fingerprintRequest(document: SignStampSource, stamp: SignStampSource, placement: SignStampPlacement): string {
  return createHash('sha256')
    .update([document.fileId, stamp.fileId, placement.page, placement.position, placement.size].join('|'))
    .digest('hex')
}

function maxSensitiveLevel(a: FileSensitiveLevel, b: FileSensitiveLevel): FileSensitiveLevel {
  return SENSITIVE_ORDER[a] >= SENSITIVE_ORDER[b] ? a : b
}

/** 文件名净化：去扩展名/路径分隔/控制字符，截断，空则回退。 */
function sanitizeBaseName(filename: string): string {
  const base = filename.replace(/\.[Pp][Dd][Ff]$/, '')
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\\/\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'document'
}

/**
 * 检测 AcroForm 数字签名域。pdf-lib 的 getForm() 对无 AcroForm 的文档会创建空表单
 * （无害：我们本来就要 save），字段枚举异常一律按"未检测到"处理 —— 冷门形态由
 * 免责声明兜底（设计 §八）。
 */
function hasDigitalSignatureField(doc: PDFDocument): boolean {
  try {
    return doc.getForm().getFields().some((field) => field instanceof PDFSignature)
  } catch {
    return false
  }
}

function parseIdempotencyState(raw: string): IdempotencyState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Record<string, unknown>
  if (candidate.status !== 'in_progress' && candidate.status !== 'completed') return null
  if (typeof candidate.fingerprint !== 'string') return null
  if (candidate.status === 'in_progress') {
    return {
      status: 'in_progress',
      fingerprint: candidate.fingerprint,
      ownerToken: typeof candidate.ownerToken === 'string' ? candidate.ownerToken : undefined,
    }
  }
  if (
    typeof candidate.fileId !== 'string' ||
    typeof candidate.fileMd5 !== 'string' ||
    typeof candidate.sizeBytes !== 'number' ||
    typeof candidate.pages !== 'number'
  ) {
    return null
  }
  return {
    status: 'completed',
    fingerprint: candidate.fingerprint,
    fileId: candidate.fileId,
    fileMd5: candidate.fileMd5,
    sizeBytes: candidate.sizeBytes,
    pages: candidate.pages,
  }
}

async function withTimeout<T>(work: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ComposeTimeoutError()), ms)
  })
  try {
    return await Promise.race([work(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter @ai-job-print/api typecheck
```
Expected: PASS。若 `TerminalCapabilitiesService` 的 `assertUserTaskAllowed` 参数类型报错，确认第二参数字面量 `'signature_stamp'` 在其 `PrintScanCapabilityKey` 副本里存在（已核实存在于 shared `printScanCapability.ts:18`，后端有对应副本）。

- [ ] **Step 3: Commit**

```bash
git add services/api/src/print-sign/print-sign.service.ts
git commit -m "feat(api): print-sign compose/inspect service — pdf-lib overlay with ownership, idempotency, capability gate"
```

---

## Task 8: Controller + Module + AppModule 注册

**Files:**
- Create: `services/api/src/print-sign/print-sign.controller.ts`
- Create: `services/api/src/print-sign/print-sign.module.ts`
- Modify: `services/api/src/app.module.ts:45` 附近（import）与 `:115` 附近（imports 数组）

- [ ] **Step 1: Controller**

```typescript
// services/api/src/print-sign/print-sign.controller.ts
import { Body, Controller, Headers, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { SignComposeResponse, SignInspectResponse } from './print-sign.types'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { SignComposeDto, SignInspectDto } from './print-sign.dto'
import { PrintSignService } from './print-sign.service'

@Controller('print/sign')
export class PrintSignController {
  constructor(
    private readonly sign: PrintSignService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Post('inspect')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async inspect(@Body() body: SignInspectDto, @Req() req: Request): Promise<ApiResponse<SignInspectResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.sign.inspect({
      terminalId: body.terminalId,
      document: body.document,
      endUserId: endUser?.endUserId ?? null,
    })
    return ApiResponse.ok(result)
  }

  @Post('compose')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async compose(
    @Body() body: SignComposeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Req() req: Request,
  ): Promise<ApiResponse<SignComposeResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.sign.compose({
      terminalId: body.terminalId,
      document: body.document,
      stamp: body.stamp,
      placement: body.placement,
      authorizationConfirmed: body.authorizationConfirmed,
      endUserId: endUser?.endUserId ?? null,
      idempotencyKey: idempotencyKey ?? null,
      requestId: requestId?.slice(0, 64) ?? null,
    })
    return ApiResponse.ok(result)
  }
}

function extractAuth(req: Request): string | undefined {
  const raw = req.headers.authorization
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw[0]
  return undefined
}
```

- [ ] **Step 2: Module**

```typescript
// services/api/src/print-sign/print-sign.module.ts
import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { PrintSignController } from './print-sign.controller'
import { PrintSignService } from './print-sign.service'

@Module({
  imports: [FilesModule, JwtVerifierModule, TerminalsModule],
  controllers: [PrintSignController],
  providers: [PrintSignService],
})
export class PrintSignModule {}
```

- [ ] **Step 3: AppModule 注册**

`services/api/src/app.module.ts`，在 `PrintConversionModule` import 行后加：

```typescript
import { PrintSignModule } from './print-sign/print-sign.module'
```

`imports` 数组中 `PrintConversionModule,` 后加：

```typescript
    PrintSignModule,
```

- [ ] **Step 4: typecheck + build**

```bash
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api build
```
Expected: 均 PASS

- [ ] **Step 5: Commit**

```bash
git add services/api/src/print-sign/ services/api/src/app.module.ts
git commit -m "feat(api): POST /print/sign/inspect + /print/sign/compose endpoints"
```

---

## Task 9: verify:print-sign 脚本 + CI 接入

**Files:**
- Create: `services/api/scripts/verify-print-sign.ts`
- Modify: `services/api/package.json:147` 附近（scripts）
- Modify: `.github/workflows/ci.yml:187` 与 `:334` 附近（两个 job）

- [ ] **Step 1: 写 verify 脚本**

说明：Fake 骨架（errCode/expectCode/FakePrisma/FakeStorage/FakeAudit/FakeFiles/FakeRedis）与 PNG fixture 生成器**照抄** `services/api/scripts/verify-print-conversion.ts`（其顶部注释解释了为何必须用 `getResponse().error.code` 断言、PNG 为何要真 CRC）。以下给出本脚本特有部分的完整代码；抄骨架时同步把 Fake 类中 `purpose: 'print_doc'` 之类的默认值参数化。

```typescript
// services/api/scripts/verify-print-sign.ts
/**
 * 签名盖章 service 级验证。内存 Fake Prisma/Storage/Audit/Files/Redis/Capabilities
 * 直接跑 PrintSignService，覆盖设计 §十 的断言清单。
 * 运行：pnpm --filter @ai-job-print/api verify:print-sign
 */
import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-sign-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { PrintSignService } from '../src/print-sign/print-sign.service'
import { computeStampDrawParams, normalizeRotation } from '../src/print-sign/print-sign-geometry'
import { signFileUrl } from '../src/files/signing'
import { countPdfPages } from '../src/files/file-page-count.util'

// ── errCode / errMessage / expectCode / pass / fail：照抄 verify-print-conversion.ts ──
// ── CRC_TABLE / crc32 / pngChunk / makePng(width,height)：照抄 verify-print-conversion.ts ──
// （此处省略的是"抄现成代码"而非"待实现"；两段合计约 110 行，抄完必须能独立编译）

// ── 手写最小 PDF fixture 生成器（正确 xref 偏移；pdf-lib 与 countPdfPages 都能读）──

interface PdfFixtureOptions {
  pages?: number
  rotate?: number            // 加到每页 /Rotate
  cropBox?: [number, number, number, number]
  encrypted?: boolean        // trailer 加 /Encrypt → pdf-lib load 抛错
  withSigField?: boolean     // AcroForm + /FT /Sig 字段 → 应被拒绝
}

function makePdf(opts: PdfFixtureOptions = {}): Buffer {
  const pages = opts.pages ?? 1
  const objects: string[] = []
  const pageRefs: string[] = []
  const firstPageObj = 3
  for (let i = 0; i < pages; i++) pageRefs.push(`${firstPageObj + i} 0 R`)
  const sigFieldObj = firstPageObj + pages
  const encryptObj = sigFieldObj + (opts.withSigField ? 1 : 0)

  const acroForm = opts.withSigField ? ` /AcroForm << /Fields [${sigFieldObj} 0 R] /SigFlags 3 >>` : ''
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R${acroForm} >>\nendobj\n`)
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages} >>\nendobj\n`)
  for (let i = 0; i < pages; i++) {
    const rotate = opts.rotate ? ` /Rotate ${opts.rotate}` : ''
    const crop = opts.cropBox ? ` /CropBox [${opts.cropBox.join(' ')}]` : ''
    const annots = opts.withSigField && i === 0 ? ` /Annots [${sigFieldObj} 0 R]` : ''
    objects.push(
      `${firstPageObj + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]${rotate}${crop}${annots} >>\nendobj\n`,
    )
  }
  if (opts.withSigField) {
    objects.push(
      `${sigFieldObj} 0 obj\n<< /FT /Sig /T (Sig1) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P ${firstPageObj} 0 R >>\nendobj\n`,
    )
  }
  if (opts.encrypted) {
    objects.push(`${encryptObj} 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (x) /U (x) /P -44 >>\nendobj\n`)
  }

  const header = '%PDF-1.4\n'
  let body = ''
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(header.length + body.length)
    body += obj
  }
  const xrefStart = header.length + body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  const encrypt = opts.encrypted ? ` /Encrypt ${encryptObj} 0 R` : ''
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypt} >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(header + body + xref + trailer, 'latin1')
}

// ── Fake 服务（Prisma/Storage/Audit/Files/Redis 照抄 verify-print-conversion.ts 的实现，
//    file 记录字段补 purpose/sensitiveLevel/filename 可配置）+ 新增 FakeCapabilities ──

class FakeCapabilities {
  status: 'available' | 'maintenance' = 'available'
  async assertUserTaskAllowed(_terminalId: string, _key: string): Promise<void> {
    if (this.status !== 'available') {
      const err = new Error('capability') as Error & { getResponse: () => unknown }
      err.getResponse = () => ({ error: { code: 'CAPABILITY_UNAVAILABLE', message: 'n/a' } })
      throw err
    }
  }
}

// ── 场景搭建辅助 ──
// seedFile(fake, { id, purpose, mimeType, sizeBytes, endUserId, ownerType, ownerId, buffer, filename, sensitiveLevel })
// guestUrl(fileId) = signFileUrl(fileId, 60_000).url   —— 游客访问凭证
// basePlacement = { page: 1, position: 'bottom-right' as const, size: 'medium' as const }
// composeArgs(overrides) —— 统一构造 compose 入参（terminalId:'t_verify', authorizationConfirmed:true）

async function main() {
  // 断言分组（每条用 expectCode / assert + pass()，Fake 组装照上文）：
  //
  // [几何单元断言 — 不经 service，直接调 computeStampDrawParams]
  //  G1 rotation 0 × 9 位置：bottom-right => x = 595*(1-0.04) - w, y = 842*0.04；其余 8 位对称公式全断言
  //  G2 rotation 90：bottom-right 在视觉空间(visualW=842, visualH=595)算 vx/vy 后
  //     断言 x = 595 - vy, y = 0 + vx（cropX/cropY=0 时），rotateDegrees=90
  //  G3 rotation 180 / 270 各抽 2 位置断言
  //  G4 细长图（imageWidth=2000, imageHeight=100）：高度不超 visualH*factor；
  //     竖长图（100×2000）：宽度按高度反算，w = h * (100/2000)
  //  G5 normalizeRotation(-90) === 270；normalizeRotation(45) === 0
  //
  // [归属/类型（compose 路径）]
  //  A1 游客 document 凭证 fileId 与请求项不一致 → SIGN_SOURCE_NOT_FOUND
  //  A2 会员访问他人 document（endUserId 不匹配）→ SIGN_SOURCE_NOT_FOUND
  //  A3 会员 document purpose='temp' → SIGN_DOC_TYPE_UNSUPPORTED
  //  A4 document mimeType='image/png' → SIGN_DOC_TYPE_UNSUPPORTED
  //  A5 stamp purpose='print_doc'（非 signature_image）→ SIGN_STAMP_TYPE_UNSUPPORTED
  //  A6 stamp mimeType='image/webp' → SIGN_STAMP_TYPE_UNSUPPORTED
  //
  // [文档形态（真实 fixture）]
  //  B1 makePdf({encrypted:true}) → SIGN_DOC_UNSUPPORTED
  //  B2 损坏 PDF（truncate 到前 40 字节）→ SIGN_DOC_UNSUPPORTED
  //  B3 makePdf({withSigField:true}) → SIGN_DOC_HAS_DIGITAL_SIGNATURE
  //  B4 makePdf({pages:31}) → SIGN_DOC_TOO_MANY_PAGES
  //  B5 placement.page=3 但文档 2 页 → SIGN_PLACEMENT_INVALID
  //  B6 document sizeBytes 记录 >15MB → SIGN_DOC_TOO_LARGE（早于存储读取）
  //  B7 stamp sizeBytes >10MB → SIGN_STAMP_TOO_LARGE；stamp IHDR 声明 6000×5000 → SIGN_STAMP_TOO_LARGE（像素）
  //
  // [inspect]
  //  C1 inspect 3 页文档 → pages===3
  //  C2 FakeCapabilities.status='maintenance' → inspect/compose 均 CAPABILITY_UNAVAILABLE
  //
  // [成功合成]
  //  D1 会员 2 页 PDF + PNG 章，bottom-right/medium/page 2 →
  //     - result.pages===2；countPdfPages(FakeStorage 最后写入的 buffer)===2（明文 /Type /Page 可数 = useObjectStreams:false 防回退）
  //     - FakeFiles 收到 assetCategory='derived'、sourceFileId=documentId、purpose='print_doc'
  //     - sensitiveLevel：document 用 resume_upload/highly_sensitive 时输出 'highly_sensitive'；print_doc/normal 时输出 'sensitive'
  //     - filename：document.filename='../we ird\u0000名字.PDF' → 输出以 '-签章合成.pdf' 结尾且不含 '/' '\\' 控制字符
  //     - printFileUrl 匹配 /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/
  //     - FakeAudit 恰一条 action='print_sign.compose'，payload 含 authorizationNoticeVersion
  //  D2 旋转页合成：makePdf({rotate:90}) 正常成功（几何正确性由 G2 断言，这里断言不抛错、页数不变）
  //  D3 「再加一处」：D1 输出 buffer seed 成新 FileObject（游客 system 归属 + 该 printFileUrl 作凭证）
  //     再次 compose → 成功（凭证同构复用成立）
  //
  // [幂等]
  //  E1 同 key 同指纹重放 → 同 fileId，FakeFiles.uploadCount 不增，审计不增
  //  E2 E1 后删除输出（FakePrisma 置 deletedAt）再重放 → 重新生成（uploadCount +1）
  //  E3 同 key 不同指纹（换 position）→ IDEMPOTENCY_KEY_REUSED
  //  E4 锁被占（手动 setNxEx in_progress 同指纹）→ SIGN_IN_PROGRESS
  //  E5 合成失败（storage.getObject 抛错一次）后同 key 立即重试 → 成功（owner-token 释放了自己的锁）
  //  E6 owner-token 不误删：手动把 key 换成他人 in_progress payload，触发一次失败请求，
  //     断言 key 仍存在（getAndDelIfEquals mismatched 不删）
  //  E7 idempotencyKey='short'（<16 字符）→ VALIDATION_FAILED
  //
  // [防御]
  //  F1 authorizationConfirmed:false 直调 service → VALIDATION_FAILED
  console.log('verify:print-sign — all assertions passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

> 实现者注意：上面 main() 内注释块是**断言实现清单**，不是可省略项——每一条都要落成真实断言代码（照 verify-print-conversion.ts 的 expectCode/assert 风格逐条展开），完成后删掉清单注释，总断言数 ≥ 28。FakeRedis 需实现 `setNxEx/setEx/get/del/incrWithTtl/getAndDelIfEquals` 六个方法（后两个是本脚本相对 conversion 版新增的：incrWithTtl 返回自增计数；getAndDelIfEquals 相等才删、返回 'matched'/'mismatched'/'missing'）。

- [ ] **Step 2: 注册 package.json 脚本**

`services/api/package.json` scripts，`verify:print-conversion` 行后加：

```json
    "verify:print-sign": "node -r @swc-node/register scripts/verify-print-sign.ts"
```

- [ ] **Step 3: 本地跑通**

```bash
pnpm --filter @ai-job-print/api verify:print-sign
```
Expected: 全部 PASS，退出码 0。若 B3（签名域检测）不触发：先打印 `doc.getForm().getFields().map(f=>f.constructor.name)` 调试 fixture 是否被 pdf-lib 识别为 PDFSignature，按需给 sig 字段对象补 `/V` 或调整 `/T` —— 修 fixture，不放宽实现。

- [ ] **Step 4: 接入 CI（两处 job）**

`.github/workflows/ci.yml` 中两处 `pnpm --filter @ai-job-print/api verify:print-conversion`（`:187`、`:334`）各自后面加一行：

```yaml
          pnpm --filter @ai-job-print/api verify:print-sign
```

- [ ] **Step 5: Commit**

```bash
git add services/api/scripts/verify-print-sign.ts services/api/package.json .github/workflows/ci.yml
git commit -m "test(api): verify:print-sign gate (28+ assertions) wired into both CI jobs"
```

---

## Task 10: Kiosk API 模块

**Files:**
- Create: `apps/kiosk/src/services/api/printSign.ts`

- [ ] **Step 1: 写实现（fetch 封装完全对齐 printConversion.ts）**

```typescript
// apps/kiosk/src/services/api/printSign.ts
//
// 签名盖章前端 API：POST /print/sign/inspect、/print/sign/compose。
// 封装方式对齐同目录 printConversion.ts（ApiHttpError 保留 error.code；网络失败本地化）。

import type {
  SignComposeRequest,
  SignComposeResponse,
  SignInspectRequest,
  SignInspectResponse,
} from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

async function post<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  let payload: ResponseEnvelope<T> | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<T>
  } catch {
    payload = null
  }
  if (!res.ok) {
    throw new ApiHttpError(payload?.error?.code ?? 'UNKNOWN_ERROR', payload?.error?.message ?? `请求失败（${res.status}）`, res.status)
  }
  if (!payload?.data) throw new ApiHttpError('SIGN_FAILED', '签章服务返回数据为空', res.status)
  return payload.data
}

export function getTerminalId(): string {
  const terminalId = (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim()
  if (!terminalId) throw new ApiHttpError('SIGN_FAILED', '终端编号未配置，无法使用签名盖章', 0)
  return terminalId
}

export async function signInspect(request: SignInspectRequest, options: { token: string | null }): Promise<SignInspectResponse> {
  const headers: Record<string, string> = {}
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  return post<SignInspectResponse>('/print/sign/inspect', request, headers)
}

export async function signCompose(
  request: SignComposeRequest,
  options: { token: string | null; idempotencyKey: string },
): Promise<SignComposeResponse> {
  const headers: Record<string, string> = { 'Idempotency-Key': options.idempotencyKey }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  return post<SignComposeResponse>('/print/sign/compose', request, headers)
}
```

- [ ] **Step 2: typecheck + Commit**

```bash
pnpm --filter @ai-job-print/kiosk typecheck
git add apps/kiosk/src/services/api/printSign.ts
git commit -m "feat(kiosk): print-sign API client"
```

---

## Task 11: Kiosk SignStampPage

**Files:**
- Create: `apps/kiosk/src/pages/print-scan/SignStampPage.tsx`

- [ ] **Step 1: 写实现（完整文件）**

```tsx
// apps/kiosk/src/pages/print-scan/SignStampPage.tsx
//
// 签名盖章（图形排版），/print-scan/sign。四步：选文档 → 传签名/印章图 →
// 选位置（页码网格 + 九宫格 + 大小档）→ 合成结果预览（iframe）。
// 入口：/print-scan 服务中心卡片；MyDocumentsPage「签名盖章」动作携
// location.state.presetDocument 直达（跳过选文档）。
// 合规：全程展示 KIOSK_PRINT_SCAN_ESIGN_NOTICE；生成前必须勾选图片使用授权。

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import {
  COMPLIANCE_COPY,
  makePrintParams,
  type SignStampPosition,
  type SignStampSize,
} from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  FileTextIcon,
  ImageIcon,
  LoaderIcon,
  PenToolIcon,
  PrinterIcon,
  QrCodeIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  StampIcon,
  UploadIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/api/files'
import { getTerminalId, signCompose, signInspect } from '../../services/api/printSign'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'

const MAX_DOC_BYTES = 15 * 1024 * 1024
const MAX_STAMP_BYTES = 10 * 1024 * 1024

/** 授权勾选文案；改动必须同步后端 AUTHORIZATION_NOTICE_VERSION（print-sign.service.ts） */
const AUTHORIZATION_LABEL = '我确认本人拥有该签名/印章图片的使用授权，仅用于本人材料的版式整理'

interface PickedFile {
  fileId: string
  fileAccessUrl: string
  name: string
  size: string
}

interface ComposeResult {
  fileId: string
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
  name: string
}

interface PresetDocumentState {
  presetDocument?: { fileId: string; fileAccessUrl: string; name: string; sizeBytes: number }
}

const POSITIONS: { key: SignStampPosition; label: string }[] = [
  { key: 'top-left', label: '左上' }, { key: 'top-center', label: '上' }, { key: 'top-right', label: '右上' },
  { key: 'middle-left', label: '左' }, { key: 'center', label: '中' }, { key: 'middle-right', label: '右' },
  { key: 'bottom-left', label: '左下' }, { key: 'bottom-center', label: '下' }, { key: 'bottom-right', label: '右下' },
]

const SIZES: { key: SignStampSize; label: string }[] = [
  { key: 'small', label: '小' }, { key: 'medium', label: '中' }, { key: 'large', label: '大' },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function friendlyError(err: unknown, fallback: string, loggedIn: boolean): string {
  const code = (err as { code?: string })?.code
  if (code === 'SIGN_SOURCE_NOT_FOUND') {
    return loggedIn
      ? '文件访问凭证已过期或文件已清理，请重新选择文件'
      : '文件访问凭证已过期（有效期约 30 分钟），请重新上传'
  }
  return err instanceof Error ? err.message : fallback
}

export function SignStampPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const docInputRef = useRef<HTMLInputElement>(null)
  const stampInputRef = useRef<HTMLInputElement>(null)

  const [document, setDocument] = useState<PickedFile | null>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [stamp, setStamp] = useState<PickedFile | null>(null)
  const [page, setPage] = useState(1)
  const [position, setPosition] = useState<SignStampPosition>('bottom-right')
  const [size, setSize] = useState<SignStampSize>('medium')
  const [authorized, setAuthorized] = useState(false)
  const [result, setResult] = useState<ComposeResult | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState<'document' | 'stamp' | null>(null)
  const [qrBusy, setQrBusy] = useState(false)

  useBusyLock(busy || qrBusy || showQr !== null)

  // 我的文档入口：presetDocument 直达（只消费一次）
  useEffect(() => {
    const preset = (location.state as PresetDocumentState | null)?.presetDocument
    if (preset && !document) {
      void acceptDocument({
        fileId: preset.fileId,
        fileAccessUrl: preset.fileAccessUrl,
        name: preset.name,
        size: formatBytes(preset.sizeBytes),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const acceptDocument = async (picked: PickedFile) => {
    setBusy(true)
    setError(null)
    try {
      const res = await signInspect(
        { terminalId: getTerminalId(), document: { fileId: picked.fileId, fileAccessUrl: picked.fileAccessUrl } },
        { token: getToken() },
      )
      setDocument(picked)
      setPages(res.pages)
      setPage(res.pages) // 默认最后一页（签名通常在末页）
      setResult(null)
    } catch (err) {
      setError(friendlyError(err, '文档检查失败，请重试', Boolean(getToken())))
    } finally {
      setBusy(false)
    }
  }

  const handleLocalDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (selected.type !== 'application/pdf') {
      setError('仅支持 PDF 文档；图片请先用「格式转换」转成 PDF')
      return
    }
    if (selected.size > MAX_DOC_BYTES) {
      setError(`文档大小不能超过 ${formatBytes(MAX_DOC_BYTES)}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await kioskUploadFile(selected, 'print_doc', getToken())
      await acceptDocument({ fileId: res.fileId, fileAccessUrl: res.signedUrl, name: res.filename, size: formatBytes(res.sizeBytes) })
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handleLocalStamp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (!['image/jpeg', 'image/png'].includes(selected.type)) {
      setError('签名/印章图片仅支持 JPG / PNG')
      return
    }
    if (selected.size > MAX_STAMP_BYTES) {
      setError(`图片大小不能超过 ${formatBytes(MAX_STAMP_BYTES)}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await kioskUploadFile(selected, 'signature_image', getToken())
      setStamp({ fileId: res.fileId, fileAccessUrl: res.signedUrl, name: res.filename, size: formatBytes(res.sizeBytes) })
      setResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handlePhoneUploaded = (target: 'document' | 'stamp') => (file: PhoneUploadedFile) => {
    if (!file.fileUrl) {
      setError('手机上传未返回可用的文件地址，请重试')
      return
    }
    const picked: PickedFile = { fileId: file.fileId, fileAccessUrl: file.fileUrl, name: file.name, size: file.size }
    setShowQr(null)
    if (target === 'document') {
      void acceptDocument(picked)
    } else {
      setStamp(picked)
      setResult(null)
    }
  }

  const handleCompose = async () => {
    if (!document || !stamp || pages === null) return
    setBusy(true)
    setError(null)
    try {
      const idempotencyKey = `sign-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
      const res = await signCompose(
        {
          terminalId: getTerminalId(),
          document: { fileId: document.fileId, fileAccessUrl: document.fileAccessUrl },
          stamp: { fileId: stamp.fileId, fileAccessUrl: stamp.fileAccessUrl },
          placement: { page, position, size },
          authorizationConfirmed: true,
        },
        { token: getToken(), idempotencyKey },
      )
      setResult({ ...res, name: `${document.name.replace(/\.pdf$/i, '')}-签章合成.pdf` })
    } catch (err) {
      setError(friendlyError(err, '生成失败，请稍后重试', Boolean(getToken())))
    } finally {
      setBusy(false)
    }
  }

  const goPrint = () => {
    if (!result) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: result.name,
          size: formatBytes(result.sizeBytes),
          pages: result.pages,
          fileId: result.fileId,
          fileUrl: result.printFileUrl,
          fileMd5: result.fileMd5,
          mimeType: 'application/pdf',
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        source: 'document',
      },
    })
  }

  const addAnother = () => {
    if (!result) return
    // 合成产物作为下一轮输入文档；printFileUrl 与上传凭证同构（设计 §2.6）
    setDocument({ fileId: result.fileId, fileAccessUrl: result.printFileUrl, name: result.name, size: formatBytes(result.sizeBytes) })
    setPages(result.pages)
    setPage(result.pages)
    setStamp(null)
    setAuthorized(false)
    setResult(null)
  }

  const redoPlacement = () => {
    setResult(null) // 保留 document/stamp，回选位；下次生成自动换新 Idempotency-Key
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-6 pb-8">
      <PageHeader
        title="签名盖章"
        subtitle="在 PDF 上叠加签名/印章图片（版式合成）"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/print-scan')}>
            返回打印扫描服务
          </Button>
        }
      />

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-info-bg bg-info-bg/70 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-neutral-600">{COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}</p>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result === null ? (
        <div className="mt-4 flex flex-col gap-4">
          {/* 第 1 步：文档 */}
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-neutral-700">第 1 步 · 选择 PDF 文档</p>
            {document ? (
              <div className="flex items-center gap-3 rounded-xl border border-neutral-100 px-3 py-2.5">
                <FileTextIcon className="h-6 w-6 shrink-0 text-primary-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">{document.name}</p>
                  <p className="text-xs text-neutral-400">{document.size}{pages !== null ? ` · 共 ${pages} 页` : ''}</p>
                </div>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setDocument(null); setPages(null); setStamp(null); setAuthorized(false) }}>
                  重新选择
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <input ref={docInputRef} type="file" accept="application/pdf" className="sr-only" onChange={(e) => void handleLocalDoc(e)} />
                <Button size="lg" variant="secondary" disabled={busy} onClick={() => docInputRef.current?.click()}>
                  {busy ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : <UploadIcon className="mr-1.5 h-5 w-5" />}
                  本机上传 PDF
                </Button>
                <Button size="lg" variant="secondary" disabled={busy} onClick={() => setShowQr('document')}>
                  <QrCodeIcon className="mr-1.5 h-5 w-5" />
                  手机扫码上传
                </Button>
              </div>
            )}
            {showQr === 'document' && (
              <div className="mt-3">
                <UploadSessionQrPanel
                  purpose="print_doc"
                  title="手机扫码上传 PDF 文档"
                  description="手机扫码上传一份 PDF，确认后自动进入下一步。"
                  confirmLabel="确认使用该文档"
                  onUploaded={handlePhoneUploaded('document')}
                  onBusyChange={setQrBusy}
                />
              </div>
            )}
          </Card>

          {/* 第 2 步：签名/印章图片 */}
          {document && (
            <Card className="p-4">
              <p className="mb-1 text-sm font-medium text-neutral-700">第 2 步 · 上传签名或印章图片</p>
              <p className="mb-3 text-xs text-neutral-400">建议上传白底或透明底 PNG；若图片方向不对，请在手机上旋转后重新上传。</p>
              {stamp ? (
                <div className="flex items-center gap-3 rounded-xl border border-neutral-100 px-3 py-2.5">
                  <StampIcon className="h-6 w-6 shrink-0 text-primary-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">{stamp.name}</p>
                    <p className="text-xs text-neutral-400">{stamp.size}</p>
                  </div>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setStamp(null); setAuthorized(false) }}>
                    重新上传
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <input ref={stampInputRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => void handleLocalStamp(e)} />
                  <Button size="lg" variant="secondary" disabled={busy} onClick={() => stampInputRef.current?.click()}>
                    {busy ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : <ImageIcon className="mr-1.5 h-5 w-5" />}
                    本机上传图片
                  </Button>
                  <Button size="lg" variant="secondary" disabled={busy} onClick={() => setShowQr('stamp')}>
                    <QrCodeIcon className="mr-1.5 h-5 w-5" />
                    手机扫码上传
                  </Button>
                </div>
              )}
              {showQr === 'stamp' && (
                <div className="mt-3">
                  <UploadSessionQrPanel
                    purpose="signature_image"
                    title="手机扫码上传签名/印章图片"
                    description="手机拍摄或选择签名/印章图片（JPG/PNG），确认后自动进入下一步。"
                    confirmLabel="确认使用该图片"
                    onUploaded={handlePhoneUploaded('stamp')}
                    onBusyChange={setQrBusy}
                  />
                </div>
              )}
            </Card>
          )}

          {/* 第 3 步：位置 */}
          {document && stamp && pages !== null && (
            <Card className="p-4">
              <p className="mb-3 text-sm font-medium text-neutral-700">第 3 步 · 选择叠加位置</p>

              <p className="mb-2 text-xs text-neutral-500">页码（共 {pages} 页）</p>
              <div className="mb-4 grid grid-cols-6 gap-2">
                {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={[
                      'flex h-12 items-center justify-center rounded-lg border text-sm font-medium',
                      p === page ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-600',
                    ].join(' ')}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <p className="mb-2 text-xs text-neutral-500">位置（对应纸面方向）</p>
              <div className="mx-auto mb-4 grid w-full max-w-xs grid-cols-3 gap-2">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos.key}
                    type="button"
                    onClick={() => setPosition(pos.key)}
                    className={[
                      'flex h-14 items-center justify-center rounded-lg border text-sm font-medium',
                      pos.key === position ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-600',
                    ].join(' ')}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>

              <p className="mb-2 text-xs text-neutral-500">大小</p>
              <div className="grid grid-cols-3 gap-2">
                {SIZES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSize(s.key)}
                    className={[
                      'flex h-12 items-center justify-center rounded-lg border text-sm font-medium',
                      s.key === size ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-600',
                    ].join(' ')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* 授权确认 + 生成 */}
          {document && stamp && pages !== null && (
            <Card className="p-4">
              <label className="flex min-h-12 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(e) => setAuthorized(e.target.checked)}
                  className="mt-1 h-6 w-6 shrink-0 accent-primary-500"
                />
                <span className="text-sm leading-relaxed text-neutral-700">{AUTHORIZATION_LABEL}</span>
              </label>
              <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                伪造、变造印章或冒用他人签名属违法行为，责任由使用者自负。本功能仅做图片版式合成，每次生成会产生一份新文件，按短期策略自动清理。
              </p>
              <Button size="lg" className="mt-4 h-14 w-full text-base" disabled={busy || !authorized} onClick={() => void handleCompose()}>
                {busy ? (
                  <>
                    <LoaderIcon className="mr-2 h-5 w-5 animate-spin" />
                    正在生成…
                  </>
                ) : (
                  <>
                    <PenToolIcon className="mr-1.5 h-5 w-5" />
                    生成合成 PDF
                  </>
                )}
              </Button>
            </Card>
          )}
        </div>
      ) : (
        /* 第 4 步：结果预览 */
        <div className="mt-4 flex flex-col gap-4">
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-neutral-700">合成完成 · 预览</p>
            <div className="h-[480px] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
              <iframe title={`${result.name} 预览`} src={result.printFileUrl} className="h-full w-full bg-white" />
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              {result.name} · {formatBytes(result.sizeBytes)} · 共 {result.pages} 页
            </p>
          </Card>
          <Button size="lg" className="h-14 w-full text-base" onClick={goPrint}>
            <PrinterIcon className="mr-1.5 h-5 w-5" />
            去打印
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="secondary" onClick={addAnother}>
              <StampIcon className="mr-1.5 h-5 w-5" />
              再加一处签名/印章
            </Button>
            <Button size="lg" variant="secondary" onClick={redoPlacement}>
              <RotateCcwIcon className="mr-1.5 h-5 w-5" />
              重新选位置
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter @ai-job-print/kiosk typecheck
```
Expected: PASS（若 `StampIcon` 在当前 lucide-react 版本不存在，换 `BadgeCheckIcon` 或 `SquarePenIcon`，全文件两处同步替换）

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/pages/print-scan/SignStampPage.tsx
git commit -m "feat(kiosk): SignStampPage four-step flow (doc -> stamp -> 9-grid placement -> preview)"
```

---

## Task 12: 入口接线（路由 / 服务中心卡片 / FeatureInfoPage 收窄 / 我的文档动作）

**Files:**
- Modify: `apps/kiosk/src/routes/index.tsx:53-55, :121-123`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx:120-129`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx`（FeatureKey 收窄为 'id-photo'）
- Modify: `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`（新增签名盖章动作）
- **不改** `apps/kiosk/src/pages/home/HomePage.tsx`（首页无此磁贴，入口稳定规则禁止新增）

- [ ] **Step 1: 路由**

`routes/index.tsx` import 区（`ConvertImagesPage` 行后）：

```typescript
import { SignStampPage } from '../pages/print-scan/SignStampPage'
```

路由表（`print-scan/convert` 行后）：

```typescript
      { path: 'print-scan/sign',         element: <SignStampPage /> },
```

- [ ] **Step 2: 点亮服务中心卡片**

`PrintScanHomePage.tsx` sign 卡片（`:120-129`）：`to` 改 `'/print-scan/sign'`，`available: false` 改 `available: true`，描述文案改为 `'在 PDF 上叠加签名/印章图片（版式合成）'`。**其余字段（key/icon/capability 映射）不动**——`CARD_CAPABILITY_KEY` 已映射 `sign → 'signature_stamp'`，能力覆盖逻辑自动生效。

- [ ] **Step 3: FeatureInfoPage 收窄**

`PrintScanFeatureInfoPage.tsx`：
- `type FeatureKey = 'id-photo' | 'sign'` → `type FeatureKey = 'id-photo'`
- 删除 `FEATURES` 里整个 `sign: {...}` 条目、`isFeatureKey` 改为 `k === 'id-photo'`
- 删除不再使用的 `PenToolIcon` import 与 `notice === 'esign'` 渲染分支及 `KIOSK_PRINT_SCAN_ESIGN_NOTICE`/`ShieldCheckIcon` 相关 import（若 `COMPLIANCE_COPY` 仍被 sensitive 分支使用则保留该 import）
- 顶部注释同步改为只描述 id-photo

- [ ] **Step 4: 我的文档「签名盖章」动作**

`MyDocumentsPage.tsx`。在 `print` 函数后新增（复用其结构；`SIGNABLE_PURPOSES` 定义放文件顶部常量区）：

```typescript
const SIGNABLE_PURPOSES = new Set(['print_doc', 'resume_upload', 'resume_scan', 'cover_letter'])
```

```typescript
  const signStamp = async (doc: MemberDocumentItem) => {
    if (opening || printingId || busyId || retentionBusy) return
    const token = getToken()
    if (!token) return
    setPrintingId(doc.id)
    try {
      const res = await fetchAccessUrl(doc.previewUrlPath, token)
      if (!res.printFileUrl) throw new Error('文件访问凭证生成失败')
      navigate('/print-scan/sign', {
        state: {
          presetDocument: {
            fileId: doc.id,
            fileAccessUrl: res.printFileUrl,
            name: doc.filename,
            sizeBytes: doc.sizeBytes,
          },
        },
      })
    } catch (error) {
      setHint(error instanceof Error ? error.message : '打开签名盖章失败，文件可能已到期或被清理')
    } finally {
      setPrintingId(null)
    }
  }
```

在文档条目的动作按钮区（「打印」按钮旁，样式对齐现有按钮）加，显示条件 = `doc.mimeType === 'application/pdf' && SIGNABLE_PURPOSES.has(doc.purpose)`：

```tsx
{doc.mimeType === 'application/pdf' && SIGNABLE_PURPOSES.has(doc.purpose) && (
  <Button size="sm" variant="secondary" disabled={printingId === doc.id} onClick={() => void signStamp(doc)}>
    签名盖章
  </Button>
)}
```

（实际按钮容器/样式以该文件现有「打印」按钮为准，保持同一行、同尺寸；若动作区是图标按钮风格则同风格实现，文案不变。）

- [ ] **Step 5: typecheck + lint**

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
```
Expected: 均 PASS

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/src/routes/index.tsx apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx
git commit -m "feat(kiosk): wire sign-stamp entries — service-center card + my-documents action (no new home tile)"
```

---

## Task 13: 全量验证 + 文档同步

**Files:**
- Modify: `docs/progress/current-progress.md`（新增条目）
- Modify: `docs/progress/next-tasks.md:137`（"首期签名盖章"条目状态）
- Modify: `docs/product/user-data-flow-matrix.md` §3.4（新增签名盖章行）

- [ ] **Step 1: 全仓 typecheck + 改动包 lint**

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck && pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint
```
Expected: 全 PASS

- [ ] **Step 2: 后端 verify 门禁（新 + 回归）**

```bash
pnpm --filter @ai-job-print/api verify:print-sign
pnpm --filter @ai-job-print/api verify:print-conversion
pnpm --filter @ai-job-print/api verify:upload-sessions
pnpm --filter @ai-job-print/api verify:cos:files
pnpm --filter @ai-job-print/api verify:print-jobs
```
Expected: 全 PASS（后四项是 files/upload-sessions 公共底座改动的回归确认）

- [ ] **Step 3: 真实建单集成断言（设计 §十 集成级）**

写一个一次性本地脚本（scratch，不入库）：用 pdf-lib 按 Task 7 相同参数（`save({useObjectStreams:false})`）合成一个 2 页样例 PDF，喂给 `PrintPageCountService.resolveBillablePages()` 所依赖的 `countPdfPages()`，断言 === 2。若已在 verify:print-sign D1 断言过 `countPdfPages(输出)`，本步骤等价完成，记录结论即可。

- [ ] **Step 4: Kiosk mock 模式浏览器走查**

启动 kiosk dev（mock 模式），走查并截图：
1. `/print-scan` 服务中心「签名盖章」卡片可点 → 进入 `/print-scan/sign`
2. 本机上传 PDF → inspect 页数显示 → 上传 PNG 章 → 页码网格/九宫格/大小档可点（按钮 ≥48px）→ 授权勾选前生成按钮禁用 → 勾选后生成 → 结果 iframe 预览 → 「去打印」携带正确 state 到 `/print/confirm`
3. 「再加一处」回流：document 变为合成产物、stamp 清空、授权重置
4. 「我的文档」PDF 条目出现「签名盖章」动作 → 直达签名页跳过第 1 步
5. 手机扫码面板打开期间待机屏不打断（useBusyLock）
6. mock 模式下非 PDF/超大文件的前端拦截文案正确

- [ ] **Step 5: 文档同步**

- `docs/progress/next-tasks.md:137`：「首期签名盖章」条目改为 `[x]`，注明"代码 + 本地 verify + mock 浏览器走查级，未预生产、未真机"，链接设计与本计划。
- `docs/progress/current-progress.md`：新增 2026-07-12 条目——签名盖章 MVP 完成范围（pdf-lib 新依赖、signature_image 新 purpose、服务端能力断言、verify:print-sign 进双 CI）、明确未做项（手写板/拖放/EXIF 归一化/真机）。
- `docs/product/user-data-flow-matrix.md` §3.4 表新增一行：

```markdown
| 签名盖章 | `/print-scan/sign` | 合成 PDF FileObject（`assetCategory=derived, sourceFileId=源文档`）、签名图片（`signature_image`，短期不进我的文档）、PrintTask | 我的文档、打印订单 | ✅ 代码级真实闭环（2026-07-12）：PDF+签名/印章图九宫格合成，pdf-lib，服务端 signature_stamp 能力断言；`verify:print-sign` 进双 CI | 仅代码 + 本地 verify + mock 走查级；未预生产、未真机；手写板/拖放定位为二期 |
```

- [ ] **Step 6: Commit + push**

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md docs/product/user-data-flow-matrix.md
git commit -m "docs: sign-stamp MVP progress sync (next-tasks / current-progress / data-flow matrix)"
git push
```

---

## 超预算红线（执行者必读）

以下改动**不在**本计划范围，出现需要即停下回报：
- 触碰 `/print/jobs`、`print-page-count`、`print-conversion` 的既有实现（包括"顺手"收敛它们的 URL 解析器）
- Prisma schema / migration（本功能零模型变更）
- Admin 前端（能力配置走既有「设备能力」页，`TASK_TYPE_TABS` 的 `signature_stamp implemented:false` 保持不动）
- 新增除 pdf-lib 外的任何依赖（含 pdfjs-dist / sharp / signature_pad）
- `HomePage.tsx`（首页不新增磁贴）
