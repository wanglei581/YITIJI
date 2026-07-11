# 格式转换（图片→PDF）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Kiosk 首页「格式转换」占位卡片做成真实功能：把 1–20 张 JPEG/PNG 图片合并为一份 PDF，然后直接进入打印确认流程。

**Architecture:** 新增独立后端模块 `print-conversion`（复用 `FilesService`/`StorageService`/`signFileUrl`/`countPdfPages`/`RedisService`，零 Prisma 改动、零新 `FilePurpose`），Kiosk 新增一个前端页面复用现有本机单文件上传 + 手机扫码上传组件（均为"一次一张、可继续添加"），生成后走既有 `/print/confirm` 链路。

**Tech Stack:** NestJS + Prisma（后端）、React + React Router（前端）、`pdfkit`（PDF 合成，仓库已有依赖）、`class-validator`（DTO 校验）、`@nestjs/throttler`（频控）、Redis（幂等）。

**关联文档：** [2026-07-11-format-conversion-design.md](../specs/2026-07-11-format-conversion-design.md)（已批准的设计）

---

## 关键技术前提（写计划前已核实，非假设）

1. `kioskUploadFile()` 调用的 `POST /files/kiosk-upload` 端点（`services/api/src/files/files.controller.ts:113-156`）对**所有**上传都会用 `signFileUrl(res.fileId, ...)` 覆盖默认的 `signedUrl`，与存储后端（本地/COS）无关。
2. 手机扫码上传对 `purpose='print_doc'` 的 `confirm()` 同样签发内部 HMAC `fileUrl`（2026-07-10 已实现，`PhoneUploadedFile.fileUrl` 字段注释明确："仅 print_doc 用途携带：本系统签名内容 URL"）。
3. 因此本功能选用的两个图片来源（本机单文件上传 + 手机扫码上传，且都固定 `purpose='print_doc'`）返回的 URL **都保证**是可被 `verifyFileSignature()` 校验的内部 HMAC 格式，不会遇到 COS 预签名 URL 混入的问题。**这一点只对 print_doc 这两个入口成立，不是通用结论。**
4. `FilesService.readContentForEndUser()` 只检查 `deletedAt`（经 `requireAlive`），不检查 `status`/`expiresAt`/`purpose`/`mimeType`，因此本功能不复用它，改为自己写完整的 Prisma 查询。
5. `RedisService`、`PrismaService`、`AuditService` 均为 `@Global()` 模块导出，新模块 `imports` 不需要显式列出。

---

## Task 1: Shared 类型定义

**Files:**
- Create: `packages/shared/src/types/printConversion.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// packages/shared/src/types/printConversion.ts

export interface ConvertImageSource {
  fileId: string
  /** 上传/扫码确认后返回的内部 HMAC 签名 URL，作为该图片的访问凭证；不用于实际读取，只用于服务端校验持有权。 */
  fileAccessUrl: string
}

export interface ConvertImagesRequest {
  sources: ConvertImageSource[]
}

export interface ConvertImagesResponse {
  fileId: string
  /** 内部 HMAC 打印链路 URL（30 分钟 TTL），不是 COS 预签名 URL。 */
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
}

export type ConvertImagesErrorCode =
  | 'CONVERT_INPUT_INVALID'
  | 'CONVERT_TOO_MANY_IMAGES'
  | 'CONVERT_SOURCE_NOT_FOUND'
  | 'CONVERT_SOURCE_TYPE_UNSUPPORTED'
  | 'CONVERT_SOURCE_TOO_LARGE'
  | 'CONVERT_IMAGE_DIMENSIONS_INVALID'
  | 'CONVERT_TOTAL_LIMIT_EXCEEDED'
  | 'CONVERT_OUTPUT_TOO_LARGE'
  | 'CONVERSION_IN_PROGRESS'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CONVERT_FAILED'
```

- [ ] **Step 2: 加入 barrel export**

在 `packages/shared/src/index.ts` 里，紧跟 `export * from './types/scanTask'` 之后新增一行：

```typescript
export * from './types/printConversion'
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @ai-job-print/shared typecheck`
Expected: 无错误退出。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/printConversion.ts packages/shared/src/index.ts
git commit -m "feat(shared): 格式转换请求/响应类型契约"
```

---

## Task 2: 图片尺寸解析工具（零新依赖）

**Files:**
- Create: `services/api/src/print-conversion/image-dimensions.util.ts`
- Test: 内联在 Task 8 的 verify 脚本中断言（本仓库约定：不用 jest，用独立 verify 脚本）

**背景**：仓库没有 `sharp`/`image-size` 之类的库，`pdfkit` 也不提供"读取任意图片宽高"的 API。PNG/JPEG 的尺寸信息都在文件头部固定偏移量，用二进制读取即可，参照仓库已有的 `file-page-count.util.ts`（手写 PDF 页数解析，同样不依赖第三方库）风格实现。

- [ ] **Step 1: 写实现**

```typescript
// services/api/src/print-conversion/image-dimensions.util.ts

export interface ImageDimensions {
  width: number
  height: number
}

/** 读取 JPEG/PNG 的像素宽高；不是这两种格式或头部损坏返回 null。 */
export function readImageDimensions(buffer: Buffer, mimeType: string): ImageDimensions | null {
  if (mimeType === 'image/png') return readPngDimensions(buffer)
  if (mimeType === 'image/jpeg') return readJpegDimensions(buffer)
  return null
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null
  const isPngSignature = buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a
  if (!isPngSignature) return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (!width || !height) return null
  return { width, height }
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]!
    // SOF0-SOF15（排除 DHT 0xC4 / JPG 0xC8 / DAC 0xCC，这三个不是帧起始段）都携带尺寸。
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      if (offset + 9 > buffer.length) return null
      const height = buffer.readUInt16BE(offset + 5)
      const width = buffer.readUInt16BE(offset + 7)
      if (!width || !height) return null
      return { width, height }
    }
    if (offset + 4 > buffer.length) return null
    const segmentLength = buffer.readUInt16BE(offset + 2)
    offset += 2 + segmentLength
  }
  return null
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: 无错误（该文件尚未被引用，只需自身语法通过）。

- [ ] **Step 3: Commit**

```bash
git add services/api/src/print-conversion/image-dimensions.util.ts
git commit -m "feat(api): 格式转换—JPEG/PNG 图片尺寸解析工具（零新依赖）"
```

---

## Task 3: 请求 DTO

**Files:**
- Create: `services/api/src/print-conversion/print-conversion.dto.ts`

- [ ] **Step 1: 写实现**

```typescript
// services/api/src/print-conversion/print-conversion.dto.ts

import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class ConvertImageSourceDto {
  @IsString()
  fileId!: string

  @IsString()
  fileAccessUrl!: string
}

export class ConvertImagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConvertImageSourceDto)
  sources!: ConvertImageSourceDto[]
}
```

（`ArrayMinSize(1)`/`ArrayMaxSize(20)` 只挡住"完全空/明显超量"的请求；20 张的业务上限仍在 service 层用 `CONVERT_TOO_MANY_IMAGES` 精确报错，这里的 DTO 校验失败会走全局 `VALIDATION_FAILED`，两层校验不冲突。）

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add services/api/src/print-conversion/print-conversion.dto.ts
git commit -m "feat(api): 格式转换请求 DTO"
```

---

## Task 4: 核心 Service — 归属校验 + 读取 + pdfkit 合并

**Files:**
- Create: `services/api/src/print-conversion/print-conversion.service.ts`

这是最核心的一步，一次写完主流程（不拆更小的子步骤，因为下面几个校验环节必须在同一个循环里顺序执行，拆开会破坏"任一环节失败则整体失败、不产出半成品"的不变量）。幂等逻辑放到 Task 5 单独加。

- [ ] **Step 1: 写实现（先不含幂等）**

```typescript
// services/api/src/print-conversion/print-conversion.service.ts

import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import PDFDocument from 'pdfkit'
import type { ConvertImageSource, ConvertImagesResponse } from '@ai-job-print/shared'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { signFileUrl, verifyFileSignature } from '../files/signing'
import { countPdfPages } from '../files/file-page-count.util'
import { readImageDimensions } from './image-dimensions.util'

const MAX_IMAGES = 20
const MAX_SINGLE_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_INPUT_BYTES = 40 * 1024 * 1024
const MAX_SINGLE_IMAGE_PIXELS = 25_000_000
const MAX_TOTAL_PIXELS = 200_000_000
const PROXY_MAX_OUTPUT_BYTES = 15 * 1024 * 1024
const OUTPUT_URL_TTL_MS = 30 * 60 * 1000
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png'])

const PAGE_WIDTH_PT = 595.28 // A4
const PAGE_HEIGHT_PT = 841.89

interface ValidatedSource {
  buffer: Buffer
}

@Injectable()
export class PrintConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  async convertImagesToPdf(args: {
    sources: ConvertImageSource[]
    endUserId: string | null
  }): Promise<ConvertImagesResponse> {
    const { sources, endUserId } = args

    if (sources.length < 1) {
      throw new BadRequestException({ error: { code: 'CONVERT_INPUT_INVALID', message: '请至少选择一张图片' } })
    }
    if (sources.length > MAX_IMAGES) {
      throw new BadRequestException({ error: { code: 'CONVERT_TOO_MANY_IMAGES', message: `最多支持 ${MAX_IMAGES} 张图片` } })
    }
    const uniqueIds = new Set(sources.map((s) => s.fileId))
    if (uniqueIds.size !== sources.length) {
      throw new BadRequestException({ error: { code: 'CONVERT_INPUT_INVALID', message: '图片列表存在重复项' } })
    }

    const validated: ValidatedSource[] = []
    let totalBytes = 0
    let totalPixels = 0

    // 顺序逐个校验 + 读取（禁止 Promise.all，避免瞬时内存峰值）。
    for (const source of sources) {
      const found = await this.prisma.fileObject.findUnique({ where: { id: source.fileId } })
      const notFound = () =>
        new NotFoundException({ error: { code: 'CONVERT_SOURCE_NOT_FOUND', message: '部分图片不存在或已失效' } })

      if (!found) throw notFound()

      const record = found
      const now = new Date()
      const baseOk =
        record.status === 'active' &&
        record.deletedAt === null &&
        (record.expiresAt === null || record.expiresAt > now) &&
        record.purpose === 'print_doc'
      if (!baseOk) throw notFound()

      const ownerOk = endUserId
        ? record.endUserId === endUserId && record.ownerType === 'user' && record.ownerId === endUserId
        : record.endUserId === null && record.ownerType === 'system' && record.ownerId === null
      if (!ownerOk) throw notFound()

      if (endUserId === null) {
        const capability = parseFileAccessUrl(source.fileAccessUrl)
        const capabilityOk =
          capability !== null &&
          capability.fileId === source.fileId &&
          verifyFileSignature(capability.fileId, capability.expires, capability.sig)
        if (!capabilityOk) throw notFound()
      }

      if (!ALLOWED_MIME_TYPES.has(record.mimeType)) {
        throw new BadRequestException({ error: { code: 'CONVERT_SOURCE_TYPE_UNSUPPORTED', message: '仅支持 JPG / PNG 图片' } })
      }
      if (record.sizeBytes > MAX_SINGLE_IMAGE_BYTES) {
        throw new BadRequestException({ error: { code: 'CONVERT_SOURCE_TOO_LARGE', message: '单张图片大小超出限制（10MB）' } })
      }
      totalBytes += record.sizeBytes
      if (totalBytes > MAX_TOTAL_INPUT_BYTES) {
        throw new BadRequestException({ error: { code: 'CONVERT_TOTAL_LIMIT_EXCEEDED', message: '图片总大小超出限制（40MB）' } })
      }

      const buffer = await this.storage.getObject(record.storageKey, record.bucket)

      const dims = readImageDimensions(buffer, record.mimeType)
      if (!dims) {
        throw new BadRequestException({ error: { code: 'CONVERT_IMAGE_DIMENSIONS_INVALID', message: '图片文件已损坏或格式不匹配' } })
      }
      const pixels = dims.width * dims.height
      if (pixels > MAX_SINGLE_IMAGE_PIXELS) {
        throw new BadRequestException({ error: { code: 'CONVERT_IMAGE_DIMENSIONS_INVALID', message: '单张图片像素超出限制' } })
      }
      totalPixels += pixels
      if (totalPixels > MAX_TOTAL_PIXELS) {
        throw new BadRequestException({ error: { code: 'CONVERT_TOTAL_LIMIT_EXCEEDED', message: '图片总像素超出限制' } })
      }

      validated.push({ buffer })
    }

    const outputBuffer = await this.mergeImagesToPdf(validated)

    const pageCount = countPdfPages(outputBuffer)
    if (pageCount !== validated.length) {
      throw new InternalServerErrorException({ error: { code: 'CONVERT_FAILED', message: 'PDF 生成校验失败，请重试' } })
    }
    if (outputBuffer.length > PROXY_MAX_OUTPUT_BYTES) {
      throw new BadRequestException({ error: { code: 'CONVERT_OUTPUT_TOO_LARGE', message: '生成的 PDF 超出大小限制，请减少图片数量' } })
    }

    const uploaded = await this.files.upload({
      buffer: outputBuffer,
      filename: `format-convert-${Date.now()}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: endUserId ?? undefined,
      assetCategory: 'derived',
      sourceFileId: null,
      createdBy: endUserId,
    })

    const printSigned = signFileUrl(uploaded.fileId, OUTPUT_URL_TTL_MS)

    await this.audit.write({
      actorId: endUserId,
      actorRole: endUserId ? 'member' : 'system',
      action: 'print_conversion.images_to_pdf',
      targetType: 'file',
      targetId: uploaded.fileId,
      payload: { sourceCount: sources.length, sourceFileIds: sources.map((s) => s.fileId) },
    })

    return {
      fileId: uploaded.fileId,
      printFileUrl: printSigned.url,
      fileMd5: uploaded.sha256,
      sizeBytes: uploaded.sizeBytes,
      pages: pageCount,
    }
  }

  private async mergeImagesToPdf(items: ValidatedSource[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ autoFirstPage: false })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', (err: Error) => reject(err))
      for (const item of items) {
        doc.addPage({ size: 'A4' })
        doc.image(item.buffer, 0, 0, { fit: [PAGE_WIDTH_PT, PAGE_HEIGHT_PT], align: 'center', valign: 'center' })
      }
      doc.end()
    })
  }
}

function parseFileAccessUrl(url: string): { fileId: string; expires: string; sig: string } | null {
  try {
    const parsed = new URL(url, 'http://internal.local')
    const match = parsed.pathname.match(/\/files\/([^/]+)\/content$/)
    const expires = parsed.searchParams.get('expires')
    const sig = parsed.searchParams.get('sig')
    if (!match || !expires || !sig) return null
    return { fileId: match[1]!, expires, sig }
  } catch {
    return null
  }
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: 无错误。（`FilesService.upload()` 的 `createdBy` 字段接受 `string | null | undefined`，`endUserId` 传 `null` 合法。）

- [ ] **Step 3: Commit**

```bash
git add services/api/src/print-conversion/print-conversion.service.ts
git commit -m "feat(api): 格式转换核心服务—归属校验+顺序读取+pdfkit合并"
```

---

## Task 5: 幂等性（Redis）

**Files:**
- Modify: `services/api/src/print-conversion/print-conversion.service.ts`

- [ ] **Step 1: 加 RedisService 依赖 + 幂等包裹逻辑**

在构造函数注入 `RedisService`；在 `convertImagesToPdf` 方法最前面插入幂等检查，方法体主流程包 `try/catch` 用于失败时释放锁，成功后写入完成态。

```typescript
// 在文件顶部 import 区新增：
import { createHash } from 'crypto'
import { RedisService } from '../common/redis/redis.service'

// 常量区新增：
const IDEMPOTENCY_LOCK_TTL_SECONDS = 120
const IDEMPOTENCY_RESULT_TTL_SECONDS = 600

// 构造函数改为：
constructor(
  private readonly prisma: PrismaService,
  private readonly storage: StorageService,
  private readonly audit: AuditService,
  private readonly files: FilesService,
  private readonly redis: RedisService,
) {}
```

`convertImagesToPdf` 方法签名与方法体改为：

```typescript
  async convertImagesToPdf(args: {
    sources: ConvertImageSource[]
    endUserId: string | null
    idempotencyKey?: string | null
  }): Promise<ConvertImagesResponse> {
    const { sources, endUserId, idempotencyKey } = args

    if (sources.length < 1) {
      throw new BadRequestException({ error: { code: 'CONVERT_INPUT_INVALID', message: '请至少选择一张图片' } })
    }
    if (sources.length > MAX_IMAGES) {
      throw new BadRequestException({ error: { code: 'CONVERT_TOO_MANY_IMAGES', message: `最多支持 ${MAX_IMAGES} 张图片` } })
    }
    const uniqueIds = new Set(sources.map((s) => s.fileId))
    if (uniqueIds.size !== sources.length) {
      throw new BadRequestException({ error: { code: 'CONVERT_INPUT_INVALID', message: '图片列表存在重复项' } })
    }

    const idemKey = idempotencyKey ? this.idempotencyRedisKey(idempotencyKey, endUserId) : null
    const fingerprint = fingerprintSources(sources)

    if (idemKey) {
      const cached = await this.claimIdempotency(idemKey, fingerprint)
      if (cached) return cached
    }

    try {
      const result = await this.doConvert(sources, endUserId)
      if (idemKey) {
        await this.redis.setEx(
          idemKey,
          IDEMPOTENCY_RESULT_TTL_SECONDS,
          JSON.stringify({ status: 'completed', fingerprint, ...result }),
        )
      }
      return result
    } catch (err) {
      if (idemKey) await this.redis.del(idemKey)
      throw err
    }
  }

  private idempotencyRedisKey(idempotencyKey: string, endUserId: string | null): string {
    return `print-conversion:idem:${endUserId ?? 'guest'}:${idempotencyKey}`
  }

  /** 返回非 null 表示命中已完成的历史结果（重新签发新的 printFileUrl）；抛异常表示冲突；返回 null 表示可以继续新流程。 */
  private async claimIdempotency(idemKey: string, fingerprint: string): Promise<ConvertImagesResponse | null> {
    const claimed = await this.redis.setNxEx(idemKey, JSON.stringify({ status: 'in_progress', fingerprint }), IDEMPOTENCY_LOCK_TTL_SECONDS)
    if (claimed) return null

    const raw = await this.redis.get(idemKey)
    if (!raw) return null // 极端竞态：占位刚好过期，按新请求继续

    const state = JSON.parse(raw) as { status: 'in_progress' | 'completed'; fingerprint: string } & Partial<ConvertImagesResponse>
    if (state.fingerprint !== fingerprint) {
      throw new ConflictException({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '该请求标识已用于另一批图片，请更换标识重试' } })
    }
    if (state.status === 'in_progress') {
      throw new ConflictException({ error: { code: 'CONVERSION_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' } })
    }
    // completed：重新签发 URL，不重复生成。
    const printSigned = signFileUrl(state.fileId!, OUTPUT_URL_TTL_MS)
    return {
      fileId: state.fileId!,
      printFileUrl: printSigned.url,
      fileMd5: state.fileMd5!,
      sizeBytes: state.sizeBytes!,
      pages: state.pages!,
    }
  }

  private async doConvert(sources: ConvertImageSource[], endUserId: string | null): Promise<ConvertImagesResponse> {
```

（把原来 `convertImagesToPdf` 里"顺序校验循环…到 return"那一整段移进这个新的私有方法 `doConvert`，方法体内容不变，只是从独立方法调用，收尾的 `}` 保持对应。）

在文件末尾（`mergeImagesToPdf` 之后、`parseFileAccessUrl` 之前）新增：

```typescript
function fingerprintSources(sources: ConvertImageSource[]): string {
  return createHash('sha256').update(sources.map((s) => s.fileId).join('|')).digest('hex')
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add services/api/src/print-conversion/print-conversion.service.ts
git commit -m "feat(api): 格式转换幂等性（Redis，同 key 复用结果/冲突拒绝）"
```

---

## Task 6: Controller + Module + 注册到 AppModule

**Files:**
- Create: `services/api/src/print-conversion/print-conversion.controller.ts`
- Create: `services/api/src/print-conversion/print-conversion.module.ts`
- Modify: `services/api/src/app.module.ts:43`（import 语句）与 `:111`（imports 数组）

- [ ] **Step 1: Controller**

```typescript
// services/api/src/print-conversion/print-conversion.controller.ts

import { Body, Controller, Headers, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { ConvertImagesResponse } from '@ai-job-print/shared'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { ConvertImagesDto } from './print-conversion.dto'
import { PrintConversionService } from './print-conversion.service'

@Controller('print/convert')
export class PrintConversionController {
  constructor(
    private readonly conversion: PrintConversionService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Post('images-to-pdf')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async imagesToPdf(
    @Body() body: ConvertImagesDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ): Promise<ApiResponse<ConvertImagesResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.conversion.convertImagesToPdf({
      sources: body.sources,
      endUserId: endUser?.endUserId ?? null,
      idempotencyKey: idempotencyKey ?? null,
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
// services/api/src/print-conversion/print-conversion.module.ts

import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { PrintConversionController } from './print-conversion.controller'
import { PrintConversionService } from './print-conversion.service'

@Module({
  imports: [FilesModule, JwtVerifierModule],
  controllers: [PrintConversionController],
  providers: [PrintConversionService],
})
export class PrintConversionModule {}
```

- [ ] **Step 3: 注册到 AppModule**

在 `services/api/src/app.module.ts` 第 43 行（`import { ScanTasksModule } from './scan-tasks/scan-tasks.module'` 之后）新增一行：

```typescript
import { PrintConversionModule } from './print-conversion/print-conversion.module'
```

在第 111 行（`ScanTasksModule,` 之后）新增一行：

```typescript
    PrintConversionModule,
```

- [ ] **Step 4: typecheck + build**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: 无错误。

Run: `pnpm --filter @ai-job-print/api build`
Expected: 构建成功，无 Nest 依赖注入错误（若 `FilesModule` 未正确导出 `FilesService` 会在这一步报错）。

- [ ] **Step 5: Commit**

```bash
git add services/api/src/print-conversion/print-conversion.controller.ts services/api/src/print-conversion/print-conversion.module.ts services/api/src/app.module.ts
git commit -m "feat(api): 格式转换 controller/module 接线，注册到 AppModule"
```

---

## Task 7: 后端 lint

**Files:** 无新文件，只跑检查。

- [ ] **Step 1: lint 本模块**

Run: `pnpm --filter @ai-job-print/api exec eslint src/print-conversion src/app.module.ts`
Expected: 0 error。若有 import 顺序或未使用变量类告警，按报错逐条修正后重跑到通过。

- [ ] **Step 2: Commit（如有修正）**

```bash
git add services/api/src/print-conversion
git commit -m "fix(api): 格式转换模块 lint 修正"
```

（若 Step 1 本来就 0 error，跳过本步。）

---

## Task 8: Verify 脚本 + package.json + CI 接入

**Files:**
- Create: `services/api/scripts/verify-print-conversion.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`（两处，约 173 行与 311 行附近，紧跟 `verify:scan-tasks` 之后）

这一步是本功能的核心验证——用内存态 Fake Prisma/Storage/Redis/Files 直接跑通 `PrintConversionService`，覆盖设计文档 §十 列出的全部场景。

- [ ] **Step 1: 写 verify 脚本**

```typescript
// services/api/scripts/verify-print-conversion.ts

import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-conversion-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import PDFDocument from 'pdfkit'
import { PrintConversionService } from '../src/print-conversion/print-conversion.service'
import { signFileUrl } from '../src/files/signing'

interface StoredFile {
  id: string
  storageKey: string
  bucket: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: string
  status: string
  deletedAt: Date | null
  expiresAt: Date | null
  endUserId: string | null
  ownerType: string
  ownerId: string | null
}

class FakePrisma {
  readonly files = new Map<string, StoredFile>()
  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) => this.files.get(where.id) ?? null,
  }
}

class FakeStorage {
  readonly objects = new Map<string, Buffer>()
  async getObject(objectKey: string): Promise<Buffer> {
    const buf = this.objects.get(objectKey)
    if (!buf) throw new Error(`object not found: ${objectKey}`)
    return buf
  }
}

class FakeAudit {
  readonly entries: Array<{ action: string; targetId?: string | null; payload?: Record<string, unknown> }> = []
  async write(args: { action: string; targetId?: string | null; payload?: Record<string, unknown> }): Promise<string | null> {
    this.entries.push(args)
    return 'audit_1'
  }
}

class FakeFiles {
  private next = 1
  constructor(private readonly prisma: FakePrisma) {}
  async upload(args: {
    buffer: Buffer
    filename: string
    mimeType: string
    purpose: string
    endUserId?: string | null
  }): Promise<{ fileId: string; filename: string; sizeBytes: number; mimeType: string; sha256: string }> {
    const id = `out_${this.next++}`
    this.prisma.files.set(id, {
      id,
      storageKey: `key_${id}`,
      bucket: 'local-fs',
      mimeType: args.mimeType,
      sizeBytes: args.buffer.length,
      sha256: `sha_${id}`,
      purpose: args.purpose,
      status: 'active',
      deletedAt: null,
      expiresAt: null,
      endUserId: args.endUserId ?? null,
      ownerType: args.endUserId ? 'user' : 'system',
      ownerId: args.endUserId ?? null,
    })
    return { fileId: id, filename: args.filename, sizeBytes: args.buffer.length, mimeType: args.mimeType, sha256: `sha_${id}` }
  }
}

class FakeRedis {
  private readonly values = new Map<string, { value: string; expiresAt: number }>()
  async get(key: string): Promise<string | null> {
    const entry = this.values.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key)
      return null
    }
    return entry.value
  }
  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
  }
  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (await this.get(key)) return false
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    return true
  }
  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0
  }
}

/** 生成一张真实可解析的最小 PNG（1x1 或指定宽高）。 */
function makePng(width: number, height: number): Buffer {
  return new Promise<Buffer>((resolve, reject) => {
    // 用 pdfkit 反向拿不到 PNG；改用最小手写 PNG（1x1 白像素，固定字节样例），
    // 宽高走 IHDR 篡改到目标值仅用于尺寸解析测试，不追求像素内容正确性。
    const base = Buffer.from(
      '89504e470d0a1a0a0000000d494844520000000100000001080600000037' +
      '6ef9240000000a49444154789c6360000002000155540d0a0000000049454e44ae426082',
      'hex',
    )
    const out = Buffer.from(base)
    out.writeUInt32BE(width, 16)
    out.writeUInt32BE(height, 20)
    resolve(out)
  }) as unknown as Buffer
}

function file(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    id: overrides.id ?? 'file_1',
    storageKey: 'key_1',
    bucket: 'local-fs',
    mimeType: 'image/png',
    sizeBytes: 1000,
    sha256: 'sha_1',
    purpose: 'print_doc',
    status: 'active',
    deletedAt: null,
    expiresAt: null,
    endUserId: null,
    ownerType: 'system',
    ownerId: null,
    ...overrides,
  }
}

function makeService() {
  const prisma = new FakePrisma() as any
  const storage = new FakeStorage() as any
  const audit = new FakeAudit() as any
  const files = new FakeFiles(prisma) as any
  const redis = new FakeRedis() as any
  const service = new PrintConversionService(prisma, storage, audit, files, redis)
  return { service, prisma, storage, audit }
}

function seedImage(prisma: FakePrisma, storage: FakeStorage, id: string, overrides: Partial<StoredFile> = {}) {
  const record = file({ id, storageKey: `key_${id}`, ...overrides })
  prisma.files.set(id, record)
  storage.objects.set(record.storageKey, makePng(100, 100))
  return record
}

function guestAccessUrl(fileId: string): string {
  return signFileUrl(fileId, 30 * 60 * 1000).url
}

async function main() {
  // 1) 空列表拒绝
  {
    const { service } = makeService()
    await assert.rejects(
      () => service.convertImagesToPdf({ sources: [], endUserId: null }),
      /CONVERT_INPUT_INVALID/,
    )
  }

  // 2) 超过 20 张拒绝
  {
    const { service, prisma, storage } = makeService()
    const sources = Array.from({ length: 21 }, (_, i) => {
      const id = `f${i}`
      seedImage(prisma, storage, id)
      return { fileId: id, fileAccessUrl: guestAccessUrl(id) }
    })
    await assert.rejects(
      () => service.convertImagesToPdf({ sources, endUserId: null }),
      /CONVERT_TOO_MANY_IMAGES/,
    )
  }

  // 3) 重复 fileId 拒绝
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'dup1')
    const url = guestAccessUrl('dup1')
    await assert.rejects(
      () => service.convertImagesToPdf({ sources: [{ fileId: 'dup1', fileAccessUrl: url }, { fileId: 'dup1', fileAccessUrl: url }], endUserId: null }),
      /CONVERT_INPUT_INVALID/,
    )
  }

  // 4) 游客 fileAccessUrl 与 fileId 不匹配 → 拒绝
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'g1')
    seedImage(prisma, storage, 'g2')
    await assert.rejects(
      () => service.convertImagesToPdf({ sources: [{ fileId: 'g1', fileAccessUrl: guestAccessUrl('g2') }], endUserId: null }),
      /CONVERT_SOURCE_NOT_FOUND/,
    )
  }

  // 5) 会员访问他人文件 → 拒绝
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'm1', { endUserId: 'other_member', ownerType: 'user', ownerId: 'other_member' })
    await assert.rejects(
      () => service.convertImagesToPdf({ sources: [{ fileId: 'm1', fileAccessUrl: '' }], endUserId: 'me' }),
      /CONVERT_SOURCE_NOT_FOUND/,
    )
  }

  // 6) 非 JPEG/PNG → 拒绝
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'w1', { mimeType: 'image/webp' })
    await assert.rejects(
      () => service.convertImagesToPdf({ sources: [{ fileId: 'w1', fileAccessUrl: guestAccessUrl('w1') }], endUserId: null }),
      /CONVERT_SOURCE_TYPE_UNSUPPORTED/,
    )
  }

  // 7) 成功合并 3 张图片 → 输出 3 页，derived，sourceFileId 相关字段不外泄
  {
    const { service, prisma, storage, audit } = makeService()
    const sources = ['a1', 'a2', 'a3'].map((id) => {
      seedImage(prisma, storage, id)
      return { fileId: id, fileAccessUrl: guestAccessUrl(id) }
    })
    const result = await service.convertImagesToPdf({ sources, endUserId: null })
    assert.equal(result.pages, 3, 'output should have 3 pages')
    assert.match(result.printFileUrl, /^\/api\/v1\/files\//, 'must return internal HMAC url, not COS url')
    assert.equal(audit.entries.length, 1)
    assert.equal(audit.entries[0]!.action, 'print_conversion.images_to_pdf')
    assert.deepEqual((audit.entries[0]!.payload as any).sourceFileIds, ['a1', 'a2', 'a3'])
  }

  // 8) 相同 Idempotency-Key 重复请求 → 返回同一输出，不重复生成
  {
    const { service, prisma, storage, audit } = makeService()
    const sources = ['b1', 'b2'].map((id) => {
      seedImage(prisma, storage, id)
      return { fileId: id, fileAccessUrl: guestAccessUrl(id) }
    })
    const first = await service.convertImagesToPdf({ sources, endUserId: null, idempotencyKey: 'k1' })
    const second = await service.convertImagesToPdf({ sources, endUserId: null, idempotencyKey: 'k1' })
    assert.equal(first.fileId, second.fileId, 'same idempotency key must reuse output')
    assert.equal(audit.entries.length, 1, 'must not audit-log twice for the same idempotency key')
  }

  // 9) 相同 key、不同图片列表 → 冲突拒绝
  {
    const { service, prisma, storage } = makeService()
    const c1 = 'c1'
    const c2 = 'c2'
    seedImage(prisma, storage, c1)
    seedImage(prisma, storage, c2)
    await service.convertImagesToPdf({ sources: [{ fileId: c1, fileAccessUrl: guestAccessUrl(c1) }], endUserId: null, idempotencyKey: 'k2' })
    await assert.rejects(
      () => service.convertImagesToPdf({ sources: [{ fileId: c2, fileAccessUrl: guestAccessUrl(c2) }], endUserId: null, idempotencyKey: 'k2' }),
      /IDEMPOTENCY_KEY_REUSED/,
    )
  }

  console.log('PASS print-conversion verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: 注册 package.json 脚本**

在 `services/api/package.json` 的 `scripts` 里，紧跟 `"verify:scan-tasks": "node -r @swc-node/register scripts/verify-scan-tasks.ts"` 之后新增一行（注意上一行末尾要补逗号）：

```json
    "verify:print-conversion": "node -r @swc-node/register scripts/verify-print-conversion.ts"
```

- [ ] **Step 3: 本地跑通**

Run: `pnpm --filter @ai-job-print/api verify:print-conversion`
Expected: 最后一行输出 `PASS print-conversion verification`，退出码 0。

如果第 7 项断言的 `makePng()` 生成的最小 PNG 在 pdfkit `doc.image()` 阶段抛错（不同 pdfkit 版本对最小 PNG 样例的容错度可能不同），改为读一张真实的 1x1 PNG fixture：在 `services/api/scripts/fixtures/`（新建目录）放一个用 Node 一次性生成并提交的真实最小 PNG 文件，`makePng()` 直接 `readFileSync` 该文件并用 `writeUInt32BE` 篡改 IHDR 宽高字段。两种方式二选一，以本地实际跑通为准。

- [ ] **Step 4: 接入 CI（两处）**

在 `.github/workflows/ci.yml` 里，找到两处 `pnpm --filter @ai-job-print/api verify:scan-tasks`（约第 173 行与第 311 行），紧随其后各新增一行：

```yaml
          pnpm --filter @ai-job-print/api verify:print-conversion
```

- [ ] **Step 5: Commit**

```bash
git add services/api/scripts/verify-print-conversion.ts services/api/package.json .github/workflows/ci.yml
git commit -m "test(api): 格式转换 verify 脚本（9 组场景）接入双 CI job"
```

---

## Task 9: Kiosk 前端 API 服务模块

**Files:**
- Create: `apps/kiosk/src/services/api/printConversion.ts`

不复用 `httpAdapter.ts`（那是招聘会 GET 适配器）。参照仓库里其他独立 API 模块（如 `services/print/printJobsApi.ts`）的直接 `fetch` 风格。

- [ ] **Step 1: 先看一眼参照文件的 fetch 封装方式**

Run: `sed -n '1,40p' apps/kiosk/src/services/print/printJobsApi.ts`

确认 `API_BASE_URL`/`fetch`/错误处理的既有写法后，按同样风格实现下面的文件（若参照文件用了某个公共 `apiFetch` 工具函数，直接复用它而不是重新手写 fetch）。

- [ ] **Step 2: 写实现**

```typescript
// apps/kiosk/src/services/api/printConversion.ts

import type { ConvertImagesRequest, ConvertImagesResponse } from '@ai-job-print/shared'
import { API_BASE_URL } from './client'

export async function convertImagesToPdf(
  request: ConvertImagesRequest,
  options: { token: string | null; idempotencyKey: string },
): Promise<ConvertImagesResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': options.idempotencyKey,
  }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`

  const res = await fetch(`${API_BASE_URL}/print/convert/images-to-pdf`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json?.error?.message ?? '格式转换失败，请稍后重试')
  }
  return json.data as ConvertImagesResponse
}
```

（`API_BASE_URL` 的导出名以 `apps/kiosk/src/services/api/client.ts` 实际导出为准；若该文件导出的是不同名字如 `API_BASE`，Step 1 已经能看到实际用法，据实调整这一处 import。）

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @ai-job-print/kiosk typecheck`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add apps/kiosk/src/services/api/printConversion.ts
git commit -m "feat(kiosk): 格式转换前端 API 模块"
```

---

## Task 10: Kiosk 新页面 ConvertImagesPage

**Files:**
- Create: `apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx`

- [ ] **Step 1: 写实现**

```tsx
// apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx
//
// 格式转换（图片→PDF），/print-scan/convert。
// 本机单文件上传（沿用 PrintUploadPage 的 A2 桌面验证定位）与手机扫码上传
// （UploadSessionQrPanel）均为"一次一张、可继续添加"；生成后直接进 /print/confirm。

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FileType2Icon,
  ImageIcon,
  LoaderIcon,
  QrCodeIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/files/filesApi'
import { convertImagesToPdf } from '../../services/api/printConversion'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'

const MAX_IMAGES = 20

interface SelectedImage {
  fileId: string
  fileAccessUrl: string
  name: string
  size: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ConvertImagesPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<SelectedImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)

  useBusyLock(uploading || generating)

  const addImage = (image: SelectedImage) => {
    setError(null)
    setImages((prev) => {
      if (prev.length >= MAX_IMAGES) {
        setError(`最多支持 ${MAX_IMAGES} 张图片，已达上限`)
        return prev
      }
      return [...prev, image]
    })
  }

  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (!['image/jpeg', 'image/png'].includes(selected.type)) {
      setError('仅支持 JPG / PNG 图片')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const res = await kioskUploadFile(selected, getToken())
      addImage({ fileId: res.fileId, fileAccessUrl: res.signedUrl, name: res.filename, size: formatBytes(res.sizeBytes) })
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  const handlePhoneUploaded = (file: PhoneUploadedFile) => {
    if (!file.fileUrl) {
      setError('手机上传未返回可用的文件地址，请重试')
      return
    }
    addImage({ fileId: file.fileId, fileAccessUrl: file.fileUrl, name: file.name, size: file.size })
    setShowQr(false)
  }

  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const tmp = next[index]!
      next[index] = next[target]!
      next[target] = tmp
      return next
    })
  }

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleGenerate = async () => {
    if (images.length === 0) {
      setError('请先添加至少一张图片')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      const idempotencyKey = `convert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const result = await convertImagesToPdf(
        { sources: images.map((img) => ({ fileId: img.fileId, fileAccessUrl: img.fileAccessUrl })) },
        { token: getToken(), idempotencyKey },
      )
      navigate('/print/confirm', {
        state: {
          file: {
            name: `格式转换-${images.length}张图片.pdf`,
            size: formatBytes(result.sizeBytes),
            pages: result.pages,
            fileId: result.fileId,
            fileUrl: result.printFileUrl,
            fileMd5: result.fileMd5,
            mimeType: 'application/pdf',
          },
          source: 'document',
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="格式转换"
        subtitle="多张图片合并为一份 PDF，仅支持 JPG / PNG"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/print-scan')}>
            返回打印扫描服务
          </Button>
        }
      />

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          转换生成的 PDF 会保存到「我的文档」，默认保存约 24 小时，可在「我的文档」页面手动延长保存期限。
        </ComplianceBanner>

        <div className="grid grid-cols-2 gap-3">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={handleLocalFile} />
          <Button size="lg" variant="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : <UploadIcon className="mr-1.5 h-5 w-5" />}
            本机上传一张
          </Button>
          <Button size="lg" variant="secondary" onClick={() => setShowQr(true)}>
            <QrCodeIcon className="mr-1.5 h-5 w-5" />
            手机扫码添加
          </Button>
        </div>

        {showQr && (
          <Card className="p-4">
            <UploadSessionQrPanel
              purpose="print_doc"
              title="手机扫码添加图片"
              description="手机扫码上传一张图片，确认后自动加入待合并列表；可重复扫码继续添加。"
              confirmLabel="确认加入待合并列表"
              onUploaded={handlePhoneUploaded}
            />
          </Card>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
            <AlertCircleIcon className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">
            待合并图片（{images.length}/{MAX_IMAGES}）
          </p>
          {images.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-neutral-400">
              <ImageIcon className="h-10 w-10" />
              <p className="text-sm">还没有添加图片</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {images.map((img, index) => (
                <div key={img.fileId} className="flex items-center gap-3 rounded-xl border border-neutral-100 px-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-semibold text-neutral-500">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">{img.name}</p>
                    <p className="text-xs text-neutral-400">{img.size}</p>
                  </div>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveImage(index, -1)}
                    className="rounded-lg p-1.5 text-neutral-400 disabled:opacity-30"
                    aria-label="上移"
                  >
                    <ArrowUpIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={index === images.length - 1}
                    onClick={() => moveImage(index, 1)}
                    className="rounded-lg p-1.5 text-neutral-400 disabled:opacity-30"
                    aria-label="下移"
                  >
                    <ArrowDownIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="rounded-lg p-1.5 text-error-fg"
                    aria-label="移除"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
        <Button size="lg" className="h-14 w-full text-base" disabled={generating || images.length === 0} onClick={() => void handleGenerate()}>
          {generating ? (
            <>
              <LoaderIcon className="mr-2 h-5 w-5 animate-spin" />
              正在生成…
            </>
          ) : (
            <>
              <FileType2Icon className="mr-1.5 h-5 w-5" />
              生成 PDF（{images.length} 张）
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @ai-job-print/kiosk typecheck`
Expected: 无错误。若 `useBusyLock`/`UploadSessionQrPanel` 的实际 import 路径或参数名与已读代码不完全一致，以 typecheck 报错为准逐一修正（本步严禁凭空猜测新路径，必须回到对应源文件确认后再改）。

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx
git commit -m "feat(kiosk): 格式转换页面—本机上传+手机扫码凑图片、生成PDF进打印确认"
```

---

## Task 11: 路由接线 + 收窄 PrintScanFeatureInfoPage + 点亮两处入口

**Files:**
- Modify: `apps/kiosk/src/routes/index.tsx:53-54,120-121`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx:100-109`
- Modify: `apps/kiosk/src/pages/home/HomePage.tsx`

- [ ] **Step 1: 路由注册**

在 `apps/kiosk/src/routes/index.tsx` 第 54 行（`import { PrintScanFeatureInfoPage } from '../pages/print-scan/PrintScanFeatureInfoPage'`）之后新增：

```typescript
import { ConvertImagesPage } from '../pages/print-scan/ConvertImagesPage'
```

在第 121 行（`{ path: 'print-scan/feature/:key', element: <PrintScanFeatureInfoPage /> },`）之后新增：

```typescript
      { path: 'print-scan/convert',      element: <ConvertImagesPage /> },
```

- [ ] **Step 2: 收窄 PrintScanFeatureInfoPage 的 FeatureKey**

在 `apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx` 里：

把

```typescript
type FeatureKey = 'id-photo' | 'convert' | 'sign'
```

改为

```typescript
type FeatureKey = 'id-photo' | 'sign'
```

把

```typescript
function isFeatureKey(k: string | undefined): k is FeatureKey {
  return k === 'id-photo' || k === 'convert' || k === 'sign'
}
```

改为

```typescript
function isFeatureKey(k: string | undefined): k is FeatureKey {
  return k === 'id-photo' || k === 'sign'
}
```

删除 `FEATURES` 常量对象里整个 `convert: { ... }` 条目（`icon: FileType2Icon` 到 `fallbackTo: '/print/upload',` 那一段，含前后花括号和逗号）。

删除后检查 `FileType2Icon` 这个 import 是否还被其他地方用到（`id-photo`/`sign` 条目不用它）；若不再使用，从顶部 `lucide-react` 的 import 列表里移除 `FileType2Icon`，避免 lint 报未使用 import。

- [ ] **Step 3: 点亮 PrintScanHomePage 的 convert 卡片**

把

```typescript
  {
    key: 'convert',
    icon: FileType2Icon,
    iconBg: 'bg-info-bg',
    iconColor: 'text-info',
    title: '格式转换',
    description: '文档与图片格式互转',
    to: '/print-scan/feature/convert',
    available: false,
  },
```

改为

```typescript
  {
    key: 'convert',
    icon: FileType2Icon,
    iconBg: 'bg-info-bg',
    iconColor: 'text-info',
    title: '格式转换',
    description: '多张图片合并为一份 PDF',
    to: '/print-scan/convert',
    available: true,
  },
```

同时把文件顶部注释块（第 4-7 行）里：

```
//   已上线：文档打印 → /print/upload、手机扫码上传 → /print/upload?tab=qr、
//           材料扫描 → /scan/start、照片打印 → /print/upload
//   MVP 说明：证件照 / 格式转换 / 签名盖章 → /print-scan/feature/:key（可点击占位）
```

改为

```
//   已上线：文档打印 → /print/upload、手机扫码上传 → /print/upload?tab=qr、
//           材料扫描 → /scan/start、照片打印 → /print/upload、
//           格式转换（多图合并PDF） → /print-scan/convert
//   MVP 说明：证件照 / 签名盖章 → /print-scan/feature/:key（可点击占位）
```

- [ ] **Step 4: 点亮 HomePage 的首页磁贴**

在 `apps/kiosk/src/pages/home/HomePage.tsx` 的「打印扫描」分组 `tiles` 数组里，把

```typescript
      { title: '格式转换', icon: 'swap', disabled: Boolean(true) },
```

改为

```typescript
      { title: '格式转换', icon: 'swap', to: '/print-scan/convert' },
```

- [ ] **Step 5: typecheck + lint**

Run: `pnpm --filter @ai-job-print/kiosk typecheck`
Expected: 无错误。

Run: `pnpm --filter @ai-job-print/kiosk exec eslint src/routes/index.tsx src/pages/print-scan src/pages/home/HomePage.tsx`
Expected: 0 error（重点检查上一步删除 `FileType2Icon` import 后是否干净）。

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/src/routes/index.tsx apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx apps/kiosk/src/pages/home/HomePage.tsx
git commit -m "feat(kiosk): 格式转换入口点亮—首页磁贴+服务中心卡片+路由"
```

---

## Task 12: 全量验证

**Files:** 无新文件，只跑检查 + 浏览器走查。

- [ ] **Step 1: 全仓 typecheck**

Run: `pnpm -r typecheck`
Expected: `shared`/`api`/`kiosk` 全部通过。

- [ ] **Step 2: 全仓 lint（改动范围内的包）**

Run: `pnpm --filter @ai-job-print/api exec eslint src/print-conversion services/api/scripts/verify-print-conversion.ts`
Run: `pnpm --filter @ai-job-print/kiosk exec eslint src/pages/print-scan src/pages/home/HomePage.tsx src/routes/index.tsx src/services/api/printConversion.ts`
Expected: 0 error。

- [ ] **Step 3: 后端 verify 脚本最终跑一遍**

Run: `pnpm --filter @ai-job-print/api verify:print-conversion`
Expected: `PASS print-conversion verification`。

- [ ] **Step 4: Kiosk mock 模式浏览器走查**

用 `preview_start({ name: 'kiosk' })` 启动开发服务器（mock 模式，无需真实后端）：

1. 打开首页，确认「打印扫描」分组的"格式转换"磁贴不再显示"即将上线"，点击后进入 `/print-scan/convert`。
2. 从 `/print-scan` 服务中心页确认"格式转换"卡片同样可点击进入同一页面。
3. 在 `/print-scan/convert` 页面点击"本机上传一张"，mock 模式下确认交互不崩溃（真实上传在 mock 模式下会走 mock adapter，属预期）。
4. 点击"手机扫码添加"，确认 `UploadSessionQrPanel` 正常渲染二维码面板（复用已验证过的现有组件，不应有新报错）。
5. 浏览器控制台（`read_console_messages`）全程无 React 报错。

- [ ] **Step 5: 完成**

若以上全部通过，本功能实现完毕。仍未完成（按设计文档 §九 已知遗留）：`FilesService.upload()` 的孤儿对象补偿清理——与本功能无关的预先存在问题，已记录不在本轮修复范围。

---

## 自查清单（写计划人自己过一遍，已确认）

1. **Spec 覆盖**：设计文档 §三（后端）→ Task 4/5/6；§四（打印确认衔接）→ Task 10 的 `handleGenerate`；§五（前端改动）→ Task 9/10/11；§六（复用/不复用）→ Task 4 只 import `FilesService`/`StorageService`/`signFileUrl`/`countPdfPages`/`RedisService`，未 import Terminal Agent 或 `MaterialsService`；§七（数据归属）→ Task 4 `purpose:'print_doc'` + `assetCategory:'derived'`；§十（验证）→ Task 8。全部有对应任务。
2. **占位符扫描**：全文无 TBD/"补充适当校验"类空话，每个错误分支都写了具体 `code`。
3. **类型一致性**：`ConvertImagesResponse`（Task 1）字段 `fileId/printFileUrl/fileMd5/sizeBytes/pages` 在 Task 4 的 service 返回值、Task 5 的幂等缓存读写、Task 10 的前端消费三处名字完全一致，未出现 `fileURL` 与 `fileUrl` 之类的大小写漂移。
4. **范围检查**：单一功能闭环（后端模块 + 前端页面 + 三处入口点亮 + verify + CI），足够作为一次独立实现交付，不需要再拆分。

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-11-format-conversion-implementation.md`.**
