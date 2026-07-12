# 证件照打印（前端规格裁剪 + A4 排版 PDF + 彩色打印）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Kiosk「证件照打印」从 disabled 占位实现为可交付 MVP：选规格 → 浏览器内裁剪 → 服务端 A4 整版排版 PDF → 既有打印链路彩色出纸，全程服务端零原生图片解码、照片不出内网、最迟约 2 小时物理删除。

**Architecture:** 裁剪缩放在 Kiosk 浏览器 canvas 完成（消除已复现两次的 `@napi-rs/canvas` 原生 `loadImage()` SIGSEGV 崩溃面，见 `services/api/src/materials/materials.service.ts:491-497`）；服务端只接收"精确等于规格目标像素"的裁剪产物，用纯 JS 的 `image-dimensions.util.ts` 硬校验后由 `pdfkit` 排版（与已上线格式转换同一安全面）。新增 FilePurpose `id_photo_print`（高敏 1h TTL 锁定）；打印建单强制证件照参数契约（`scale:'actual'` 等）并在建单成功后由服务端删除源文件。

**Tech Stack:** NestJS + Prisma + Redis + pdfkit（后端）；React + 原生 canvas（Kiosk）；验证走仓库 verify-script 惯例（`node -r @swc-node/register`）+ 双 CI。

**权威设计（禁止偏离其中隐私/参数契约）：** [docs/superpowers/specs/2026-07-12-id-photo-design.md](../specs/2026-07-12-id-photo-design.md)（已经外部 Codex architect 评审吸收）。

**分支/worktree：** 全部工作在当前 worktree 的 `feature/id-photo-design` 分支上继续（设计文档已在此分支 commit `dae61395`），不动 main。

**通用约定（每个任务都适用）：**
- 提交信息末尾统一带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- typecheck 命令：`pnpm --filter @ai-job-print/shared typecheck`、`pnpm --filter @ai-job-print/api typecheck`、`pnpm --filter @ai-job-print/kiosk typecheck`、`pnpm --filter @ai-job-print/admin typecheck`（各包均有该 script）。
- verify 命令：`pnpm --filter @ai-job-print/api verify:<name>`。
- 错误响应形状统一 `{ error: { code, message } }`；断言错误码必须用 `getResponse().error.code`（NestJS 不会把该形状塞进 exception.message，见 `services/api/scripts/verify-print-conversion.ts` 顶部注释）。

---

### Task 1: shared 契约与规格常量

**Files:**
- Create: `packages/shared/src/types/idPhoto.ts`
- Modify: `packages/shared/src/index.ts`（导出）

- [ ] **Step 1: 写 shared 类型文件**

```typescript
// packages/shared/src/types/idPhoto.ts
// ============================================================
// 证件照打印契约（SSOT）。
// 服务端镜像：services/api/src/id-photo/id-photo.types.ts —— 任何字段变更必须同时改两处。
// 设计：docs/superpowers/specs/2026-07-12-id-photo-design.md
// ============================================================

export type IdPhotoSpecId = 'one_inch' | 'small_one_inch' | 'two_inch' | 'small_two_inch'

export interface IdPhotoSpec {
  specId: IdPhotoSpecId
  label: string
  widthMm: number
  heightMm: number
  /** 300dpi 裁剪产物必须精确等于的像素尺寸（服务端硬校验锚点） */
  widthPx: number
  heightPx: number
}

export const ID_PHOTO_SPECS: readonly IdPhotoSpec[] = [
  { specId: 'one_inch', label: '一寸', widthMm: 25, heightMm: 35, widthPx: 295, heightPx: 413 },
  { specId: 'small_one_inch', label: '小一寸', widthMm: 22, heightMm: 32, widthPx: 260, heightPx: 378 },
  { specId: 'two_inch', label: '二寸', widthMm: 35, heightMm: 49, widthPx: 413, heightPx: 579 },
  { specId: 'small_two_inch', label: '小二寸', widthMm: 35, heightMm: 45, widthPx: 413, heightPx: 531 },
]

export function getIdPhotoSpec(specId: string): IdPhotoSpec | undefined {
  return ID_PHOTO_SPECS.find((s) => s.specId === specId)
}

export interface IdPhotoLayoutSource {
  fileId: string
  /** 上传确认后返回的内部 HMAC 签名 URL，作为访问凭证；服务端不用它读取，只校验持有权。 */
  fileAccessUrl: string
}

export interface IdPhotoLayoutRequest {
  source: IdPhotoLayoutSource
  specId: IdPhotoSpecId
  terminalId: string
}

export interface IdPhotoLayoutResponse {
  fileId: string
  /** 内部 HMAC 打印链路 URL（30 分钟 TTL），不是 COS 预签名 URL。 */
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
  specId: IdPhotoSpecId
  /** 每版张数（整版排满） */
  layoutCount: number
  /** 仅游客返回：源文件（裁剪产物）的删除 action token，与读取 URL 不可互换。 */
  sourceDeleteToken?: string
}
```

- [ ] **Step 2: 导出。** 先看现有导出方式：`grep -n "printConversion" packages/shared/src/index.ts`，在同一段落按同样格式加一行：

```typescript
export * from './types/idPhoto'
```

（若现有格式是 `export type { ... } from ...` 的精确导出，则照该格式列出本文件全部导出名。）

- [ ] **Step 3: 跑 typecheck**

Run: `pnpm --filter @ai-job-print/shared typecheck`
Expected: 通过，无错误。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/idPhoto.ts packages/shared/src/index.ts
git commit -m "feat(shared): id-photo spec constants and layout contract"
```

---

### Task 2: 新增 FilePurpose `id_photo_print` 全链条

> 设计 §4.6 的完整改动清单。`Record<FilePurpose, ...>` 映射漏项会直接 typecheck 报错——这是本任务的安全网，所以先加 union 再跑 typecheck 找出全部必改点。

**Files:**
- Modify: `packages/shared/src/types/file.ts:22` 附近（union）
- Modify: `services/api/src/files/file.types.ts:17-30` 附近（union）
- Modify: `services/api/src/files/file-validation.ts:50-90`（PURPOSE_POLICY + DEFAULT_SENSITIVE_BY_PURPOSE）
- Modify: `services/api/src/files/retention-policy.ts:80-128`（allowedPoliciesForFile + assertCanSetRetention）
- Modify: `services/api/src/storage/object-key.ts:57-75`（PURPOSE_FOLDER）
- Modify: `apps/admin/src/routes/files/fileMeta.ts:10` 附近（标签行）
- Modify: `apps/admin/src/services/api/files.ts:20` 附近（union 镜像）
- Modify: `apps/kiosk/src/services/api/filesMockAdapter.ts:14` 附近（敏感级映射）

- [ ] **Step 1: 两处 FilePurpose union 各加一行**（shared 与 api 镜像，注释一致）：

```typescript
  | 'id_photo_print'   // 证件照排版 PDF(高敏,服务端生成,用户不可直接上传)
```

- [ ] **Step 2: 跑 typecheck 暴露全部 Record 漏项**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: FAIL——`PURPOSE_POLICY`、`DEFAULT_SENSITIVE_BY_PURPOSE`、`PURPOSE_FOLDER` 缺 `id_photo_print` 键的类型错误。若报错位置多于这三处，说明设计清单有遗漏，**逐个补上并在 PR 描述里记录**。

- [ ] **Step 3: 补齐各映射**

`file-validation.ts` `PURPOSE_POLICY`（放在 `id_scan` 行后）：

```typescript
  // 证件照排版 PDF：仅服务端生成物（id-photo 模块 FilesService.upload），不进任何用户上传 DTO 白名单
  id_photo_print: { mimes: ['application/pdf'], maxBytes: 20 * MB },
```

`file-validation.ts` `DEFAULT_SENSITIVE_BY_PURPOSE`：

```typescript
  id_photo_print: 'highly_sensitive',
```

`retention-policy.ts` `allowedPoliciesForFile`（第 84 行改为覆盖两种证件类 purpose）：

```typescript
  if (input.purpose === 'id_scan' || input.purpose === 'id_photo_print') return ['system_short']
```

`retention-policy.ts` `assertCanSetRetention`（第 113 行同样扩展，错误码沿用既有 `RETENTION_ID_SCAN_LOCKED`，消息改中性表述）：

```typescript
  if ((input.purpose === 'id_scan' || input.purpose === 'id_photo_print') && input.policy !== 'system_short') {
    throw new RetentionPolicyError('RETENTION_ID_SCAN_LOCKED', '证件类文件只能使用系统短期保存')
  }
```

`object-key.ts` `PURPOSE_FOLDER`（C 端分组内）：

```typescript
  id_photo_print: { scope: 'user', folder: 'id-photos' },
```

`apps/admin/src/routes/files/fileMeta.ts`（对齐现有行格式）：

```typescript
  id_photo_print:       { label: '证件照排版',  style: 'bg-error-bg text-error-fg',       source: '证件照服务' },
```

`apps/admin/src/services/api/files.ts` union 加 `| 'id_photo_print'`。

`apps/kiosk/src/services/api/filesMockAdapter.ts` 敏感级映射加：

```typescript
  id_photo_print: 'highly_sensitive',
```

**确认不改**：`create-upload-intent.dto.ts` / `upload-options.dto.ts` / `kiosk-upload-options.dto.ts` 三个用户上传白名单**不得**加入该 purpose（设计 §4.6）。

- [ ] **Step 4: 全量 typecheck + 留存策略回归**

Run: `pnpm --filter @ai-job-print/api typecheck && pnpm --filter @ai-job-print/shared typecheck && pnpm --filter @ai-job-print/admin typecheck && pnpm --filter @ai-job-print/kiosk typecheck`
Expected: 全部通过。

Run: `pnpm --filter @ai-job-print/api verify:file-retention`
Expected: PASS（既有断言不回归）。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/file.ts services/api/src/files/file.types.ts services/api/src/files/file-validation.ts services/api/src/files/retention-policy.ts services/api/src/storage/object-key.ts apps/admin/src/routes/files/fileMeta.ts apps/admin/src/services/api/files.ts apps/kiosk/src/services/api/filesMockAdapter.ts
git commit -m "feat(files): add id_photo_print purpose with locked short-term retention"
```

---

### Task 3: 游客删除 action token（signing.ts）

> 设计 §4.9：删除授权不得复用读取 `fileAccessUrl`；独立命名空间 HMAC token，模式对齐同文件既有 `signRawUploadUrl` 的命名空间隔离做法。

**Files:**
- Modify: `services/api/src/files/signing.ts`（文件末尾追加）

- [ ] **Step 1: 追加两个函数**

```typescript
// ── 证件照源文件删除 action token(游客用) ─────────────────────────────
//
// 设计(docs/superpowers/specs/2026-07-12-id-photo-design.md §4.9):
//   - 读取 capability(/files/:id/content 签名 URL)不得扩张为破坏性删除授权,
//     因此删除用独立命名空间('id-photo-delete.'),两者互换必然验签失败。
//   - token 放请求体传输,不放 URL query。

export function signIdPhotoDeleteToken(fileId: string, ttlMs: number): { token: string; expiresAt: Date } {
  const expiresAtMs = Date.now() + ttlMs
  const message = `id-photo-delete.${fileId}.${expiresAtMs}`
  const signature = createHmac('sha256', getSecret()).update(message).digest('hex')
  return { token: `${expiresAtMs}.${signature}`, expiresAt: new Date(expiresAtMs) }
}

export function verifyIdPhotoDeleteToken(fileId: string, token: string): boolean {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot >= token.length - 1) return false
  const expiresMs = Number(token.slice(0, dot))
  const sig = token.slice(dot + 1)
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return false
  const message = `id-photo-delete.${fileId}.${expiresMs}`
  const expected = createHmac('sha256', getSecret()).update(message).digest('hex')
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add services/api/src/files/signing.ts
git commit -m "feat(files): namespaced id-photo delete action token"
```

---

### Task 4: id-photo 后端模块（layout + delete 端点）

> 组织方式完全对照 `services/api/src/print-conversion/`。幂等三点强化、审计强一致、并发槽、能力门禁全部按设计 §4 落地。

**Files:**
- Create: `services/api/src/id-photo/id-photo.types.ts`
- Create: `services/api/src/id-photo/id-photo.dto.ts`
- Create: `services/api/src/id-photo/id-photo.service.ts`
- Create: `services/api/src/id-photo/id-photo.controller.ts`
- Create: `services/api/src/id-photo/id-photo.module.ts`
- Modify: `services/api/src/app.module.ts`（import + imports 数组，紧邻 `PrintConversionModule` 的第 45/115 行）

- [ ] **Step 1: 类型镜像**

```typescript
// services/api/src/id-photo/id-photo.types.ts
/**
 * 证件照契约本地副本。
 * **契约源**：packages/shared/src/types/idPhoto.ts
 * services/api(CJS) 无法直接 import ESM-only 的 packages/shared —— 与
 * print-conversion.types.ts 同一约定。任何字段变更必须同时改两处。
 */

export type IdPhotoSpecId = 'one_inch' | 'small_one_inch' | 'two_inch' | 'small_two_inch'

export interface IdPhotoSpec {
  specId: IdPhotoSpecId
  label: string
  widthMm: number
  heightMm: number
  widthPx: number
  heightPx: number
}

export const ID_PHOTO_SPECS: readonly IdPhotoSpec[] = [
  { specId: 'one_inch', label: '一寸', widthMm: 25, heightMm: 35, widthPx: 295, heightPx: 413 },
  { specId: 'small_one_inch', label: '小一寸', widthMm: 22, heightMm: 32, widthPx: 260, heightPx: 378 },
  { specId: 'two_inch', label: '二寸', widthMm: 35, heightMm: 49, widthPx: 413, heightPx: 579 },
  { specId: 'small_two_inch', label: '小二寸', widthMm: 35, heightMm: 45, widthPx: 413, heightPx: 531 },
]

export interface IdPhotoLayoutSource {
  fileId: string
  fileAccessUrl: string
}

export interface IdPhotoLayoutResponse {
  fileId: string
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
  specId: IdPhotoSpecId
  layoutCount: number
  sourceDeleteToken?: string
}
```

- [ ] **Step 2: DTO**

```typescript
// services/api/src/id-photo/id-photo.dto.ts
import { IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import type { IdPhotoSpecId } from './id-photo.types'

export class IdPhotoLayoutSourceDto {
  @IsString()
  fileId!: string

  @IsString()
  fileAccessUrl!: string
}

export class CreateIdPhotoLayoutDto {
  @ValidateNested()
  @Type(() => IdPhotoLayoutSourceDto)
  source!: IdPhotoLayoutSourceDto

  @IsIn(['one_inch', 'small_one_inch', 'two_inch', 'small_two_inch'])
  specId!: IdPhotoSpecId

  @IsString()
  @MaxLength(64)
  terminalId!: string
}

export class DeleteIdPhotoSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  deleteToken?: string
}
```

- [ ] **Step 3: Service（核心，完整实现）**

```typescript
// services/api/src/id-photo/id-photo.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import PDFDocument from 'pdfkit'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import type { IdPhotoLayoutResponse, IdPhotoLayoutSource, IdPhotoSpec, IdPhotoSpecId } from './id-photo.types'
import { ID_PHOTO_SPECS } from './id-photo.types'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { RedisService } from '../common/redis/redis.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import { signFileUrl, verifyFileSignature, signIdPhotoDeleteToken, verifyIdPhotoDeleteToken } from '../files/signing'
import { countPdfPages } from '../files/file-page-count.util'
import { readImageDimensions } from '../print-conversion/image-dimensions.util'

const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_BYTES = 15 * 1024 * 1024
const OUTPUT_URL_TTL_MS = 30 * 60 * 1000
const FALLBACK_DELETE_TOKEN_TTL_MS = 60 * 60 * 1000
const IDEMPOTENCY_LOCK_TTL_SECONDS = 120
// 设计 §4.10：completed 缓存 TTL 与输出文件 1h TTL 对齐（不照搬格式转换的 10 分钟）。
const IDEMPOTENCY_RESULT_TTL_SECONDS = 3600
const GENERATION_SLOT_KEYS = ['id-photo:gen-slot:0', 'id-photo:gen-slot:1'] as const
const GENERATION_SLOT_TTL_SECONDS = 120
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png'])

// A4 整版排版常量（设计 §三）
const PAGE_W_MM = 210
const PAGE_H_MM = 297
const MARGIN_MM = 10
const GAP_MM = 4
const MM_TO_PT = 72 / 25.4

/** 整版行列数（纯函数，供 verify 直接断言）。 */
export function computeGrid(spec: IdPhotoSpec): { cols: number; rows: number; count: number } {
  const cols = Math.floor((PAGE_W_MM - 2 * MARGIN_MM + GAP_MM) / (spec.widthMm + GAP_MM))
  const rows = Math.floor((PAGE_H_MM - 2 * MARGIN_MM + GAP_MM) / (spec.heightMm + GAP_MM))
  return { cols, rows, count: cols * rows }
}

interface IdemState {
  status: 'in_progress' | 'completed'
  fingerprint: string
  fileId?: string
  fileMd5?: string
  sizeBytes?: number
  pages?: number
  layoutCount?: number
  specId?: IdPhotoSpecId
}

@Injectable()
export class IdPhotoService {
  private readonly logger = new Logger(IdPhotoService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
    private readonly capabilities: TerminalCapabilitiesService,
  ) {}

  async generateLayout(args: {
    source: IdPhotoLayoutSource
    specId: string
    terminalId: string
    endUserId: string | null
    idempotencyKey?: string | null
  }): Promise<IdPhotoLayoutResponse> {
    const spec = ID_PHOTO_SPECS.find((s) => s.specId === args.specId)
    if (!spec) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_SPEC_UNKNOWN', message: '不支持的证件照规格' } })
    }

    const terminalDbId = await this.resolveTerminalDbId(args.terminalId)
    await this.capabilities.assertUserTaskAllowed(terminalDbId, 'id_photo')

    // 设计 §4.10：fingerprint 含 sourceFileId + specId + terminalId（身份已编入 idemKey）
    const fingerprint = createHash('sha256')
      .update(`${args.source.fileId}|${spec.specId}|${args.terminalId}`)
      .digest('hex')
    const idemKey = args.idempotencyKey
      ? `id-photo:idem:${args.endUserId ?? 'guest'}:${args.idempotencyKey}`
      : null

    if (idemKey) {
      const cached = await this.claimIdempotency(idemKey, args.source, args.endUserId, fingerprint, terminalDbId, spec)
      if (cached) return cached
    }

    // 设计 §4.10：全局并发 ≤2，Redis 槽位带 TTL，进程崩溃自动释放；抢不到直接拒绝。
    const slot = await this.acquireSlot()
    if (!slot) {
      if (idemKey) await this.redis.del(idemKey)
      throw new ConflictException({ error: { code: 'IDPHOTO_BUSY', message: '当前生成任务较多，请稍后重试' } })
    }

    try {
      const result = await this.doGenerate(args.source, args.endUserId, spec)
      if (idemKey) {
        await this.redis.setEx(
          idemKey,
          IDEMPOTENCY_RESULT_TTL_SECONDS,
          JSON.stringify({
            status: 'completed',
            fingerprint,
            fileId: result.fileId,
            fileMd5: result.fileMd5,
            sizeBytes: result.sizeBytes,
            pages: result.pages,
            layoutCount: result.layoutCount,
            specId: result.specId,
          }),
        )
      }
      return result
    } catch (err) {
      if (idemKey) await this.redis.del(idemKey)
      throw err
    } finally {
      await this.redis.del(slot)
    }
  }

  /** 设计 §4.9：手动删除端点。幂等在端点层实现（FilesService._delete 对已删文件会抛错）。 */
  async deleteSource(args: {
    fileId: string
    endUserId: string | null
    deleteToken?: string | null
  }): Promise<{ deleted: true }> {
    const notFound = () =>
      new NotFoundException({ error: { code: 'IDPHOTO_SOURCE_NOT_FOUND', message: '文件不存在或已删除' } })
    const record = await this.prisma.fileObject.findUnique({ where: { id: args.fileId } })
    if (!record || record.purpose !== 'id_scan') throw notFound()
    if (record.status === 'deleted' || record.deletedAt) return { deleted: true }

    if (args.endUserId) {
      if (record.endUserId !== args.endUserId || record.ownerType !== 'user') throw notFound()
      await this.files.ownerDelete(args.fileId, { kind: 'member', endUserId: args.endUserId }, 'id_photo manual delete')
    } else {
      const tokenOk = typeof args.deleteToken === 'string' && verifyIdPhotoDeleteToken(args.fileId, args.deleteToken)
      if (!tokenOk || record.endUserId !== null || record.ownerType !== 'system') throw notFound()
      await this.files.systemDelete(args.fileId, 'id_photo manual delete (guest)')
    }

    await this.audit.write({
      actorId: args.endUserId,
      actorRole: args.endUserId ? 'member' : 'system',
      action: 'id_photo.source_deleted',
      targetType: 'file',
      targetId: args.fileId,
      payload: { trigger: 'manual' },
    })
    return { deleted: true }
  }

  private async resolveTerminalDbId(terminalRef: string): Promise<string> {
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
      select: { id: true },
    })
    if (!terminal) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_INPUT_INVALID', message: '终端标识无效' } })
    }
    return terminal.id
  }

  private async acquireSlot(): Promise<string | null> {
    for (const slot of GENERATION_SLOT_KEYS) {
      if (await this.redis.setNxEx(slot, '1', GENERATION_SLOT_TTL_SECONDS)) return slot
    }
    return null
  }

  /**
   * 幂等 claim（模式对齐 print-conversion.service.ts，三点强化见设计 §4.10）：
   * completed 命中前重做归属校验 + 终端能力门禁 + 输出文件存活检查；
   * 输出已失效则清缓存重新抢锁再走新流程。
   */
  private async claimIdempotency(
    idemKey: string,
    source: IdPhotoLayoutSource,
    endUserId: string | null,
    fingerprint: string,
    terminalDbId: string,
    spec: IdPhotoSpec,
  ): Promise<IdPhotoLayoutResponse | null> {
    const lockPayload = JSON.stringify({ status: 'in_progress', fingerprint })

    const claimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
    if (claimed) return null

    let state = parseIdemState(await this.redis.get(idemKey))
    if (!state) {
      const retryClaimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
      if (retryClaimed) return null
      state = parseIdemState(await this.redis.get(idemKey))
      if (!state) return null
    }

    if (state.fingerprint !== fingerprint) {
      throw new ConflictException({
        error: { code: 'IDPHOTO_IDEMPOTENCY_KEY_REUSED', message: '该请求标识已用于另一次生成，请更换标识重试' },
      })
    }
    if (state.status === 'in_progress') {
      throw new ConflictException({
        error: { code: 'IDPHOTO_GENERATION_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' },
      })
    }

    const sourceRecord = await this.verifySourceOwnership(source, endUserId)
    await this.capabilities.assertUserTaskAllowed(terminalDbId, 'id_photo')

    const output = await this.prisma.fileObject.findUnique({ where: { id: state.fileId! } })
    const now = new Date()
    const outputAlive =
      output !== null &&
      output.status === 'active' &&
      output.deletedAt === null &&
      (output.expiresAt === null || output.expiresAt > now)
    if (!outputAlive) {
      // 1h 文件 TTL 下"缓存指向已删文件"很容易发生：清缓存重新抢锁重新生成。
      await this.redis.del(idemKey)
      const reclaimed = await this.redis.setNxEx(idemKey, lockPayload, IDEMPOTENCY_LOCK_TTL_SECONDS)
      if (!reclaimed) {
        throw new ConflictException({
          error: { code: 'IDPHOTO_GENERATION_IN_PROGRESS', message: '上一次生成仍在进行中，请稍候重试' },
        })
      }
      return null
    }

    const printSigned = signFileUrl(state.fileId!, OUTPUT_URL_TTL_MS)
    const response: IdPhotoLayoutResponse = {
      fileId: state.fileId!,
      printFileUrl: printSigned.url,
      fileMd5: state.fileMd5!,
      sizeBytes: state.sizeBytes!,
      pages: state.pages!,
      specId: state.specId ?? spec.specId,
      layoutCount: state.layoutCount!,
    }
    this.attachGuestDeleteToken(response, source.fileId, endUserId, sourceRecord.expiresAt)
    return response
  }

  /** 归属校验：对齐 print-conversion.service.ts verifySourceOwnership，purpose 换成 id_scan。 */
  private async verifySourceOwnership(source: IdPhotoLayoutSource, endUserId: string | null) {
    const notFound = () =>
      new NotFoundException({ error: { code: 'IDPHOTO_SOURCE_NOT_FOUND', message: '照片不存在或已失效' } })
    const record = await this.prisma.fileObject.findUnique({ where: { id: source.fileId } })
    if (!record) throw notFound()

    const now = new Date()
    const baseOk =
      record.status === 'active' &&
      record.deletedAt === null &&
      (record.expiresAt === null || record.expiresAt > now) &&
      record.purpose === 'id_scan'
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

    return record
  }

  private async doGenerate(
    source: IdPhotoLayoutSource,
    endUserId: string | null,
    spec: IdPhotoSpec,
  ): Promise<IdPhotoLayoutResponse> {
    const record = await this.verifySourceOwnership(source, endUserId)

    if (!ALLOWED_MIME_TYPES.has(record.mimeType)) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_SOURCE_TYPE_UNSUPPORTED', message: '仅支持 JPG / PNG 图片' } })
    }
    if (record.sizeBytes > MAX_SOURCE_BYTES) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_SOURCE_TOO_LARGE', message: '图片大小超出限制（10MB）' } })
    }

    const buffer = await this.storage.getObject(record.storageKey, record.bucket)
    const dims = readImageDimensions(buffer, record.mimeType)
    if (!dims) {
      throw new BadRequestException({ error: { code: 'IDPHOTO_INPUT_INVALID', message: '图片文件已损坏或格式不匹配' } })
    }
    // 设计 §4.4：服务端锚定——裁剪产物必须精确等于规格目标像素。
    if (dims.width !== spec.widthPx || dims.height !== spec.heightPx) {
      throw new BadRequestException({
        error: {
          code: 'IDPHOTO_DIMENSIONS_MISMATCH',
          message: `裁剪结果尺寸不符合规格要求（需 ${spec.widthPx}×${spec.heightPx}px）`,
        },
      })
    }

    const { pdf, layoutCount } = await this.buildLayoutPdf(buffer, spec)

    if (countPdfPages(pdf) !== 1) {
      throw new InternalServerErrorException({ error: { code: 'IDPHOTO_FAILED', message: 'PDF 生成校验失败，请重试' } })
    }
    if (pdf.length > MAX_OUTPUT_BYTES) {
      throw new InternalServerErrorException({ error: { code: 'IDPHOTO_FAILED', message: '生成的 PDF 超出大小限制' } })
    }

    const uploaded = await this.files.upload({
      buffer: pdf,
      filename: `id-photo-${spec.specId}-${Date.now()}.pdf`,
      mimeType: 'application/pdf',
      purpose: 'id_photo_print',
      uploaderId: null,
      endUserId: endUserId ?? undefined,
      assetCategory: 'derived',
      sourceFileId: source.fileId,
      createdBy: endUserId,
    })

    // 设计 §4.5 审计强一致：高敏文件不允许"生成成功但无审计"——
    // AuditService.write 失败返回 null（fail-open 只对普通业务），此处显式检查并回滚输出。
    const auditId = await this.audit.write({
      actorId: endUserId,
      actorRole: endUserId ? 'member' : 'system',
      action: 'id_photo.layout_generated',
      targetType: 'file',
      targetId: uploaded.fileId,
      payload: { specId: spec.specId, sourceFileId: source.fileId, layoutCount },
    })
    if (!auditId) {
      await this.files.systemDelete(uploaded.fileId, 'id_photo layout audit write failed').catch(() => undefined)
      throw new InternalServerErrorException({ error: { code: 'IDPHOTO_FAILED', message: '生成失败，请重试' } })
    }

    const printSigned = signFileUrl(uploaded.fileId, OUTPUT_URL_TTL_MS)
    const response: IdPhotoLayoutResponse = {
      fileId: uploaded.fileId,
      printFileUrl: printSigned.url,
      fileMd5: uploaded.sha256,
      sizeBytes: uploaded.sizeBytes,
      pages: 1,
      specId: spec.specId,
      layoutCount,
    }
    this.attachGuestDeleteToken(response, source.fileId, endUserId, record.expiresAt)
    return response
  }

  /** 游客场景下发删除 action token，有效期覆盖源文件剩余生命周期（设计 §4.9）。 */
  private attachGuestDeleteToken(
    response: IdPhotoLayoutResponse,
    sourceFileId: string,
    endUserId: string | null,
    sourceExpiresAt: Date | null,
  ): void {
    if (endUserId) return
    const remainingMs = sourceExpiresAt ? sourceExpiresAt.getTime() - Date.now() : FALLBACK_DELETE_TOKEN_TTL_MS
    if (remainingMs <= 0) return
    response.sourceDeleteToken = signIdPhotoDeleteToken(sourceFileId, remainingMs).token
  }

  private async buildLayoutPdf(imageBuffer: Buffer, spec: IdPhotoSpec): Promise<{ pdf: Buffer; layoutCount: number }> {
    const grid = computeGrid(spec)
    if (grid.count < 1) {
      throw new InternalServerErrorException({ error: { code: 'IDPHOTO_FAILED', message: '排版计算失败' } })
    }
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0 })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), layoutCount: grid.count }))
      doc.on('error', (e: Error) => reject(e))

      const hasCjk = tryRegisterCjkFont(doc)

      const cellW = spec.widthMm * MM_TO_PT
      const cellH = spec.heightMm * MM_TO_PT
      const gap = GAP_MM * MM_TO_PT
      const usedW = grid.cols * cellW + (grid.cols - 1) * gap
      const usedH = grid.rows * cellH + (grid.rows - 1) * gap
      const originX = (PAGE_W_MM * MM_TO_PT - usedW) / 2
      const originY = (PAGE_H_MM * MM_TO_PT - usedH) / 2

      // 设计 §三：pdfkit 对 Buffer 不做缓存，直接每格传 buffer 会输出体积 = 单张 × 格数。
      // openImage 一次注册 XObject、多次放置引用（verify 有体积断言防回归）。
      const image = (doc as unknown as { openImage: (src: Buffer) => unknown }).openImage(imageBuffer)

      for (let r = 0; r < grid.rows; r += 1) {
        for (let c = 0; c < grid.cols; c += 1) {
          const x = originX + c * (cellW + gap)
          const y = originY + r * (cellH + gap)
          doc.image(image as never, x, y, { width: cellW, height: cellH })
          doc.rect(x, y, cellW, cellH).lineWidth(0.4).stroke('#bbbbbb')
        }
      }

      const dateStr = new Date().toISOString().slice(0, 10)
      const footer = hasCjk
        ? `证件照 ${spec.label} ${spec.widthMm}×${spec.heightMm}mm · ${dateStr} · 彩色激光打印`
        : `ID photo ${spec.widthMm}x${spec.heightMm}mm - ${dateStr} - Color Laser`
      doc
        .fontSize(8)
        .fillColor('#999999')
        .text(footer, 0, PAGE_H_MM * MM_TO_PT - 18, { align: 'center', width: PAGE_W_MM * MM_TO_PT })

      doc.end()
    })
  }
}

/** CJK 字体候选注册（复制 resume-pdf.service.ts fontCandidates 的降级模式；全失败则页脚退 ASCII）。 */
function tryRegisterCjkFont(doc: InstanceType<typeof PDFDocument>): boolean {
  const candidates: Array<{ path: string; family?: string }> = []
  const custom = process.env['PDF_CJK_FONT_PATH']
  if (custom) candidates.push({ path: custom, family: process.env['PDF_CJK_FONT_FAMILY'] || undefined })
  if (process.platform === 'win32') {
    const winDir = process.env['WINDIR'] || 'C:\\Windows'
    candidates.push(
      { path: `${winDir}\\Fonts\\msyh.ttc`, family: 'Microsoft YaHei' },
      { path: `${winDir}\\Fonts\\simhei.ttf` },
    )
  } else if (process.platform === 'darwin') {
    candidates.push({ path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' })
  } else {
    candidates.push(
      { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
      { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
    )
  }
  for (const c of candidates) {
    if (!existsSync(c.path)) continue
    try {
      if (c.family) doc.registerFont('cjk', c.path, c.family)
      else doc.registerFont('cjk', c.path)
      doc.font('cjk')
      return true
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return false
}

function parseIdemState(raw: string | null): IdemState | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const c = parsed as Record<string, unknown>
  if (c.status !== 'in_progress' && c.status !== 'completed') return null
  if (typeof c.fingerprint !== 'string') return null
  if (c.status === 'in_progress') return { status: 'in_progress', fingerprint: c.fingerprint }
  if (
    typeof c.fileId !== 'string' ||
    typeof c.fileMd5 !== 'string' ||
    typeof c.sizeBytes !== 'number' ||
    typeof c.pages !== 'number' ||
    typeof c.layoutCount !== 'number'
  ) {
    return null
  }
  return {
    status: 'completed',
    fingerprint: c.fingerprint,
    fileId: c.fileId,
    fileMd5: c.fileMd5,
    sizeBytes: c.sizeBytes,
    pages: c.pages,
    layoutCount: c.layoutCount,
    specId: typeof c.specId === 'string' ? (c.specId as IdPhotoSpecId) : undefined,
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

- [ ] **Step 4: Controller + Module**

```typescript
// services/api/src/id-photo/id-photo.controller.ts
import { Body, Controller, Delete, Headers, Param, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { IdPhotoLayoutResponse } from './id-photo.types'
import { RedisService } from '../common/redis/redis.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CreateIdPhotoLayoutDto, DeleteIdPhotoSourceDto } from './id-photo.dto'
import { IdPhotoService } from './id-photo.service'

@Controller('print/id-photo')
export class IdPhotoController {
  constructor(
    private readonly idPhoto: IdPhotoService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Post('layout')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  async layout(
    @Body() body: CreateIdPhotoLayoutDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ): Promise<ApiResponse<IdPhotoLayoutResponse>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.idPhoto.generateLayout({
      source: body.source,
      specId: body.specId,
      terminalId: body.terminalId,
      endUserId: endUser?.endUserId ?? null,
      idempotencyKey: idempotencyKey ?? null,
    })
    return ApiResponse.ok(result)
  }

  // 设计 §4.9：删除 token 走请求体，不放 URL query。
  @Delete('file/:fileId')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async deleteFile(
    @Param('fileId') fileId: string,
    @Body() body: DeleteIdPhotoSourceDto,
    @Req() req: Request,
  ): Promise<ApiResponse<{ deleted: true }>> {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.idPhoto.deleteSource({
      fileId,
      endUserId: endUser?.endUserId ?? null,
      deleteToken: body?.deleteToken ?? null,
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

```typescript
// services/api/src/id-photo/id-photo.module.ts
import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { IdPhotoController } from './id-photo.controller'
import { IdPhotoService } from './id-photo.service'

@Module({
  imports: [FilesModule, JwtVerifierModule, TerminalsModule],
  controllers: [IdPhotoController],
  providers: [IdPhotoService],
})
export class IdPhotoModule {}
```

`app.module.ts`：第 45 行旁加 `import { IdPhotoModule } from './id-photo/id-photo.module'`，第 115 行 `PrintConversionModule,` 后加 `IdPhotoModule,`。

- [ ] **Step 5: typecheck + 路由注册冒烟**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: 通过。

Run（本地起进程确认依赖注入与路由注册无误，起来即杀）:
```bash
cd services/api && timeout 30 node -r @swc-node/register src/main.ts 2>&1 | grep -E "id-photo|IdPhoto|error" | head -20
```
Expected: 日志出现 `Mapped {/api/v1/print/id-photo/layout, POST}` 与 `Mapped {/api/v1/print/id-photo/file/:fileId, DELETE}`，无依赖注入错误。（若 main.ts 启动需 env，参照 verify 脚本顶部或 `.env.example` 补最小 env。）

- [ ] **Step 6: Commit**

```bash
git add services/api/src/id-photo/ services/api/src/app.module.ts
git commit -m "feat(api): id-photo layout module (A4 grid pdf, idempotency, capability gate, guest delete token)"
```

---

### Task 5: verify:id-photo（service 级验证 + 注册）

**Files:**
- Create: `services/api/scripts/verify-id-photo.ts`
- Modify: `services/api/package.json`（scripts，`verify:print-conversion` 行旁）

- [ ] **Step 1: 注册 script**

`services/api/package.json` scripts 加：

```json
    "verify:id-photo": "node -r @swc-node/register scripts/verify-id-photo.ts",
```

- [ ] **Step 2: 写 verify 脚本**

夹具与骨架**直接复制** `services/api/scripts/verify-print-conversion.ts` 的以下部分（该文件 603 行，已在生产 CI 稳定运行）：
- `pass` / `fail` / `errCode` / `errMessage` 帮助函数（约 50–96 行）
- `CRC_TABLE` / `crc32` / `pngChunk` / `makePng` / `withLyingDimensions` PNG 夹具生成器（约 98–180 行）——`makePng(width, height)` 生成真实可被 pdfkit 内嵌的最小 PNG
- `FakePrisma` / `FakeStorage` / `FakeAudit` / `FakeFiles` / `FakeRedis` 内存假件（约 180–330 行），按下述差异调整

与格式转换 verify 的差异点（必改）：

```typescript
// 顶部 env 与 import
import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-id-photo-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { IdPhotoService, computeGrid } from '../src/id-photo/id-photo.service'
import { ID_PHOTO_SPECS } from '../src/id-photo/id-photo.types'
import { signFileUrl, signIdPhotoDeleteToken } from '../src/files/signing'

// FakePrisma 需额外支持 terminal.findFirst（capability 门禁前的终端解析）：
class FakePrisma {
  // ...沿用 fileObject 的 findUnique/create/update store...
  terminal = {
    findFirst: async (args: { where: { OR: Array<{ id?: string; terminalCode?: string }> } }) => {
      const ref = args.where.OR[0]?.id
      return ref === 'term_ok' || args.where.OR[1]?.terminalCode === 'term_ok' ? { id: 'term_ok' } : null
    },
  }
  terminalCapability = {
    findUnique: async () => null, // 未配置行（managed 默认放行）；strict 断言用 FakeCapabilities 直接注入
  }
}

// FakeCapabilities：可编程门禁（默认放行；置 rejectNext=true 时抛 ForbiddenException）
class FakeCapabilities {
  rejectNext = false
  async assertUserTaskAllowed(_terminalId: string, _key: string): Promise<void> {
    if (this.rejectNext) {
      const { ForbiddenException } = await import('@nestjs/common')
      throw new ForbiddenException({ error: { code: 'CAPABILITY_UNAVAILABLE', message: 'gate' } })
    }
  }
}

// FakeFiles 需实现 upload / systemDelete / ownerDelete；FakeAudit 需可编程 write 返回 null
// （审计强一致断言用）：
class FakeAudit {
  failNext = false
  entries: Array<Record<string, unknown>> = []
  async write(args: Record<string, unknown>): Promise<string | null> {
    if (this.failNext) { this.failNext = false; return null }
    this.entries.push(args)
    return `audit_${this.entries.length}`
  }
}

function makeService() {
  const prisma = new FakePrisma()
  const storage = new FakeStorage()
  const audit = new FakeAudit()
  const files = new FakeFiles(prisma, storage)
  const redis = new FakeRedis()
  const capabilities = new FakeCapabilities()
  const service = new IdPhotoService(
    prisma as never, storage as never, audit as never,
    files as never, redis as never, capabilities as never,
  )
  return { service, prisma, storage, audit, files, redis, capabilities }
}

// 源文件夹具：purpose='id_scan'、尺寸精确等于规格（一寸 295×413）
function seedIdScan(prisma: FakePrisma, storage: FakeStorage, id: string, overrides = {}) {
  // 同 conversion 的 seedImage，但 purpose: 'id_scan'，storage 内容 makePng(295, 413)
}
```

断言用例（`main()` 内顺序执行，每条 `pass(...)`）：

1. 未知 specId → `IDPHOTO_SPEC_UNKNOWN`
2. 终端不存在（terminalId 传 `term_missing`）→ `IDPHOTO_INPUT_INVALID`
3. purpose 非 `id_scan`（seed 一个 `print_doc` 文件）→ 404 `IDPHOTO_SOURCE_NOT_FOUND`
4. 会员访问他人文件（seed endUserId='other'，请求 endUserId='me'）→ 404
5. 游客 `fileAccessUrl` 与 fileId 不匹配（用 `signFileUrl('别的id')` 拼的 URL）→ 404
6. 尺寸不匹配（`withLyingDimensions(makePng(4,4), 295, 412)` 即高度差 1px）→ `IDPHOTO_DIMENSIONS_MISMATCH`
7. 损坏图片（`Buffer.from('not an image')`，mimeType 伪装 image/png）→ `IDPHOTO_INPUT_INVALID`，**且进程不退出**（服务端零原生解码的防回归断言——本断言天然成立，防未来引入原生解码）
8. 成功生成（一寸 295×413 真实 PNG）→ 校验：`pages===1`；`layoutCount === computeGrid(一寸spec).count`（应为 42）；输出 `purpose='id_photo_print'`、`assetCategory='derived'`、`sourceFileId` 正确；`printFileUrl` 匹配 `/files/.+/content\?expires=`（内部 HMAC 非 COS）；审计有 `id_photo.layout_generated`
9. **XObject 复用体积断言**：输出 `sizeBytes < 输入 PNG 大小 × 3 + 200KB`（42 格若逐格内嵌会是 42 倍，复用则只多结构开销）
10. 游客成功生成 → 响应含 `sourceDeleteToken`；会员生成 → 不含
11. 幂等：同 key 同请求重复调用 → 返回同一 `fileId`，`files.upload` 只被调用一次
12. 幂等命中但输出文件已删除（手动把输出 record 置 `status='deleted'`）→ 重新生成，返回新 `fileId`
13. 幂等命中时能力门禁复验：`capabilities.rejectNext = true` 后重放同 key → 抛 Forbidden（缓存不能绕过门禁）
14. 同 key 不同 spec → 409 `IDPHOTO_IDEMPOTENCY_KEY_REUSED`
15. 审计写失败（`audit.failNext = true`）→ `IDPHOTO_FAILED` 且输出文件被 `systemDelete` 回滚（FakeFiles 记录删除调用）
16. 删除端点：会员本人删除成功（`ownerDelete` 被调用 + 审计 `id_photo.source_deleted`）；重复删除幂等返回成功
17. 删除端点：游客凭 `signIdPhotoDeleteToken(fileId, 60000).token` 删除成功；**拿读取 `fileAccessUrl` 当 deleteToken → 404**（token 不可互换断言）；他人会员删除游客文件 → 404
18. 并发槽：手动占满 `id-photo:gen-slot:0/1`（FakeRedis 预置两个 key）→ `IDPHOTO_BUSY`

- [ ] **Step 3: 跑 verify**

Run: `pnpm --filter @ai-job-print/api verify:id-photo`
Expected: 18 条 PASS，exit 0。（首次运行如有失败，按错误修 service/脚本，直到全绿。）

- [ ] **Step 4: Commit**

```bash
git add services/api/scripts/verify-id-photo.ts services/api/package.json
git commit -m "test(api): verify:id-photo service-level assertions (18 cases)"
```

---

### Task 6: print-jobs 参数契约 + 建单后源删除

> 设计 §六参数契约 + §4.9 主删除路径。`verify-print-jobs.ts` 是真实 DB 的 service 级 E2E，直接在其中追加用例。

**Files:**
- Modify: `services/api/src/print-jobs/print-jobs.service.ts`（构造器 + create() 两处 + 新私有方法）
- Modify: `services/api/src/print-jobs/print-jobs.module.ts`（imports 加 FilesModule）
- Modify: `services/api/scripts/verify-print-jobs.ts`（构造器参数 + 追加两个用例）

- [ ] **Step 1: module + 构造器注入 FilesService**

`print-jobs.module.ts` imports 数组加 `FilesModule`（`import { FilesModule } from '../files/files.module'`）。

`print-jobs.service.ts` 构造器追加参数（放最后）：

```typescript
    private readonly files: FilesService,
```

并加 import：`import { FilesService } from '../files/files.service'`；类内加 `private readonly logger = new Logger(PrintJobsService.name)`（import Logger from '@nestjs/common'，若已有则跳过）。

- [ ] **Step 2: create() 内加参数契约校验**

位置：`const storedParams: Record<string, unknown> = { ... }`（约 277 行）之后、`const orderNo = makeOrderNo()` 之前插入：

```typescript
    // 证件照排版 PDF 强制专用打印参数契约（设计 §六）：scale=actual 保证规格物理尺寸
    // 不被 Agent 的"适合页面"缩放破坏；彩色/单面/A4 固定。不信任前端，「我的文档」重印同受保护。
    const fileRecord = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { purpose: true, sourceFileId: true },
    })
    if (fileRecord?.purpose === 'id_photo_print') {
      const contractOk =
        storedParams['scale'] === 'actual' &&
        storedParams['colorMode'] === 'color' &&
        storedParams['duplex'] === 'simplex' &&
        storedParams['paperSize'] === 'A4'
      if (!contractOk) {
        throw new BadRequestException({
          error: {
            code: 'PRINT_PARAMS_INVALID_FOR_ID_PHOTO',
            message: '证件照打印参数不符合要求（彩色、单面、A4、原始尺寸）',
          },
        })
      }
    }
```

- [ ] **Step 3: create() 末尾（audit.write 之后、return 之前）加源删除**

```typescript
    // 证件照：建单成功后服务端删除裁剪产物源文件（设计 §4.9 主删除路径；
    // 失败只记日志不影响建单，1h TTL + cron 兜底）。
    if (fileRecord?.purpose === 'id_photo_print' && fileRecord.sourceFileId) {
      await this.deleteIdPhotoSourceAfterCreate(fileRecord.sourceFileId, task.id)
    }
```

新私有方法（类内任意位置）：

```typescript
  private async deleteIdPhotoSourceAfterCreate(sourceFileId: string, printTaskId: string): Promise<void> {
    try {
      const source = await this.prisma.fileObject.findUnique({
        where: { id: sourceFileId },
        select: { purpose: true, status: true, deletedAt: true },
      })
      if (!source || source.purpose !== 'id_scan' || source.status === 'deleted' || source.deletedAt) return
      await this.files.systemDelete(sourceFileId, 'id_photo source auto-delete after print task created')
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'id_photo.source_deleted',
        targetType: 'file',
        targetId: sourceFileId,
        payload: { trigger: 'print_task_created', printTaskId },
      })
    } catch (err) {
      this.logger.warn(`id_photo source auto-delete failed (${sourceFileId}): ${(err as Error).message}`)
    }
  }
```

- [ ] **Step 4: 更新 verify-print-jobs.ts 构造器并追加用例**

构造器调用处（68 行附近）追加实参：

```typescript
  const files = new FilesService(prisma, audit, storage)
  const printJobs = new PrintJobsService(
    prisma,
    audit,
    new PrintPageCountService(prisma, storage),
    new PricingService(prisma),
    new OrderStatusService(prisma, audit),
    new TerminalCapabilitiesService(prisma),
    files,
  )
```

（顶部加 `import { FilesService } from '../src/files/files.service'`。）

在既有成功建单用例之后追加两个用例（沿用该脚本的真实 DB 夹具风格；`suffix`/`terminalId`/`createdTaskIds`/cleanup 均沿用，新 fileId 记得加进 cleanup 的 deleteMany）：

```typescript
    // ── 证件照参数契约 + 建单后源删除 ────────────────────────────────
    const idpSourceId = `file_vpj_idsrc_${suffix}`
    const idpLayoutId = `file_vpj_idlay_${suffix}`
    const idpLayoutKey = `verify/print-jobs/${idpLayoutId}.pdf`
    await prisma.fileObject.create({
      data: {
        id: idpSourceId, storageKey: `verify/print-jobs/${idpSourceId}.jpg`, filename: 'crop.jpg',
        mimeType: 'image/jpeg', sizeBytes: 1024, sha256: '', purpose: 'id_scan',
        bucket: LOCAL_BUCKET_SENTINEL, ownerType: 'system', status: 'active',
      },
    })
    await storage.putObject(idpLayoutKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: idpLayoutId, storageKey: idpLayoutKey, filename: 'layout.pdf',
        mimeType: 'application/pdf', sizeBytes: pdfBytes.length, sha256: '',
        purpose: 'id_photo_print', sourceFileId: idpSourceId,
        bucket: LOCAL_BUCKET_SENTINEL, ownerType: 'system', status: 'active',
      },
    })
    const idpFileUrl = signFileUrl(idpLayoutId, 5 * 60 * 1000).url

    // 用例 A：不满足契约（默认黑白/fit）→ PRINT_PARAMS_INVALID_FOR_ID_PHOTO
    try {
      await printJobs.create(
        { fileUrl: idpFileUrl, params: makePrintParams({ copies: 1, color: 'bw' }) },
        { terminalId },
      )
      fail('证件照非契约参数建单本应被拒')
    } catch (e) {
      assert.equal(errCode(e), 'PRINT_PARAMS_INVALID_FOR_ID_PHOTO')
      pass('证件照参数契约：黑白/fit 被拒')
    }

    // 用例 B：满足契约 → 建单成功 + 源文件被自动删除 + 审计落库
    const idpCreated = await printJobs.create(
      {
        fileUrl: idpFileUrl,
        params: makePrintParams({ copies: 1, color: 'color', scale: 'actual', duplex: 'simplex', paperSize: 'A4' }),
      },
      { terminalId },
    )
    createdTaskIds.push(idpCreated.taskId)
    const idpSourceAfter = await prisma.fileObject.findUnique({ where: { id: idpSourceId } })
    assert.equal(idpSourceAfter?.status, 'deleted')
    assert.ok(idpSourceAfter?.deletedAt)
    const idpDelAudit = await prisma.auditLog.findFirst({
      where: { action: 'id_photo.source_deleted', targetId: idpSourceId },
    })
    assert.ok(idpDelAudit, '建单后源删除审计缺失')
    pass('证件照契约参数建单成功，源文件已自动删除并审计')
```

（顶部若无则补 `import { makePrintParams } from '@ai-job-print/shared'`——若该脚本因 CJS 无法 import shared，改为字面量 params 对象：`{ copies: 1, colorMode: 'color', duplex: 'simplex', paperSize: 'A4', orientation: 'portrait', quality: 'standard', scale: 'actual', pageRange: 'all', pagesPerSheet: 1 }`，字段全集以 `packages/shared/src/types/print.ts` 的 `DEFAULT_PRINT_JOB_PARAMS` 为准。cleanup 中追加 `idpSourceId`/`idpLayoutId` 的 fileObject deleteMany 与 `idpLayoutKey` 的 storage.deleteObject，以及两个文件相关 auditLog 清理。）

- [ ] **Step 5: 跑回归**

Run: `pnpm --filter @ai-job-print/api typecheck && pnpm --filter @ai-job-print/api verify:print-jobs`
Expected: 既有断言 + 新增 2 用例全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add services/api/src/print-jobs/ services/api/scripts/verify-print-jobs.ts
git commit -m "feat(print-jobs): enforce id-photo print param contract; auto-delete source after task creation"
```

---

### Task 7: materials OCR 显式隔离

> 设计 §五：不依赖零引用的 `HIGH_RISK_PII_PURPOSES`；按可信 `FileObject.purpose` 在材料任务入口直接拒绝证件类文件，杜绝 1 小时窗口内被送外部 OCR。

**Files:**
- Modify: `services/api/src/materials/materials.service.ts`（`createTask` 入口，第 129 行 `assertCanUseSourceFile` 之后）
- Modify: `services/api/scripts/verify-materials-processing.ts`（追加断言）

- [ ] **Step 1: createTask 加拒绝分支**

在 `this.assertCanUseSourceFile(sourceFile, requester)` 之后插入：

```typescript
    // 证件类文件（证件照裁剪产物 / 排版 PDF）显式禁止进入材料处理链路——
    // pii_scan 会对任意 purpose 做真实抽取且可能调用第三方 OCR，与证件照
    // "照片全程不出内网"的隐私承诺冲突（设计 2026-07-12-id-photo-design.md §五）。
    if (sourceFile.purpose === 'id_scan' || sourceFile.purpose === 'id_photo_print') {
      throw new BadRequestException({
        error: { code: 'MATERIAL_SOURCE_PURPOSE_FORBIDDEN', message: '证件类文件不支持材料检查' },
      })
    }
```

（确认文件顶部已 import `BadRequestException`，materials.service.ts 已在用。）

- [ ] **Step 2: verify 追加断言**

打开 `services/api/scripts/verify-materials-processing.ts`，找到其创建 sourceFile 夹具与调用 `createTask` 的既有用例，仿照追加：seed 一个 `purpose: 'id_scan'` 的 FileObject，调用 `createTask({ kind: 'pii_scan', sourceFileId, ... })`，断言 `errCode === 'MATERIAL_SOURCE_PURPOSE_FORBIDDEN'`，`pass('证件类文件被材料链路拒绝（OCR 隔离）')`。

- [ ] **Step 3: 跑回归**

Run: `pnpm --filter @ai-job-print/api verify:materials-processing`
Expected: 既有断言 + 新增 1 条全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add services/api/src/materials/materials.service.ts services/api/scripts/verify-materials-processing.ts
git commit -m "feat(materials): reject id-scan/id-photo files from material tasks (OCR isolation)"
```

---

### Task 8: 扫码上传会话扩 `id_scan` + 上传审计

> 设计 §4.7 表格逐项落地（服务端部分）。

**Files:**
- Modify: `services/api/src/upload-sessions/upload-sessions.service.ts:99`（集合）、`:103`（构造器）、`:209`（filename 兜底）、`:234` 附近（confirm 分支）、`upload()` 内（审计）
- Modify: `services/api/src/upload-sessions/upload-sessions.dto.ts:9`（`@IsIn`）
- Modify: `services/api/src/upload-sessions/upload-sessions.module.ts`（若 AuditService 非全局需确认 imports——先看 `print-conversion.module.ts` 怎么拿到 AuditService，照抄）
- Modify: `services/api/scripts/verify-upload-sessions.ts`（追加断言）

- [ ] **Step 1: 服务端四处修改**

```typescript
// :99
const SUPPORTED_UPLOAD_SESSION_PURPOSES: ReadonlySet<FilePurpose> = new Set(['resume_upload', 'print_doc', 'id_scan'])
```

构造器注入 AuditService（import `AuditService` from '../audit/audit.service'）：

```typescript
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}
```

`upload()` 内 `files.upload` 成功、`persist(uploaded)` 之后补上传审计（设计 §4.7：手机扫码路径此前完全没有 `file.upload` 审计；对所有 purpose 一并补上，属低风险改进）：

```typescript
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'file.upload',
        targetType: 'file',
        targetId: file.fileId,
        payload: { channel: 'upload_session', purpose: latest.purpose, sessionId: latest.sessionId },
      })
```

filename 兜底（:209）改三分支：

```typescript
          filename: args.file.originalname || (latest.purpose === 'print_doc' ? 'document.pdf' : latest.purpose === 'id_scan' ? 'id-photo.jpg' : 'resume.pdf'),
```

`confirm()` 的 fileUrl 分支（:259 附近）扩成两 purpose（`id_scan` 需要 `fileUrl` 供 Kiosk fetch 原图 + 作为 layout 的 `fileAccessUrl` 凭证）：

```typescript
    if (record.purpose === 'print_doc' || record.purpose === 'id_scan') {
      const signed = signFileUrl(confirmedFile.fileId, PRINT_UPLOAD_URL_TTL_MS)
      confirmedFile = { ...confirmedFile, fileUrl: signed.url }
    }
```

- [ ] **Step 2: DTO**

```typescript
  @IsIn(['resume_upload', 'print_doc', 'id_scan'])
```

- [ ] **Step 3: 注释同步**

`packages/shared` 中 `UploadSessionFileView.fileUrl` 的注释（grep `仅 print_doc` 定位，文件在 `packages/shared/src/types/` 下）与 Kiosk `UploadSessionQrPanel.tsx:24` 的 `/** 仅 print_doc 用途携带... */` 注释改为"print_doc / id_scan 用途携带"。

- [ ] **Step 4: verify 追加断言**

在 `services/api/scripts/verify-upload-sessions.ts` 中仿照既有 print_doc 用例追加：创建 `purpose: 'id_scan'` 会话 → 手机上传一张 `image/jpeg`（夹具字节可用 Task 5 复制的 `makePng`，mimeType 报 image/png）→ confirm → 断言：`file.fileUrl` 存在且匹配 `/files/.+/content\?expires=`；`prisma.auditLog` 有 `action: 'file.upload'` 且 payload.channel==='upload_session'。再补一条负例：`purpose: 'id_scan'` 会话上传 `application/pdf` → 被 `validateUpload` 拒（IMG 白名单自动生效）。

- [ ] **Step 5: 跑回归**

Run: `pnpm --filter @ai-job-print/api verify:upload-sessions && pnpm --filter @ai-job-print/api typecheck`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add services/api/src/upload-sessions/ packages/shared/src services/api/scripts/verify-upload-sessions.ts apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx
git commit -m "feat(upload-sessions): support id_scan purpose with upload audit and signed fileUrl"
```

---

### Task 9: 手机 H5 页与扫码面板的 id_scan 适配

**Files:**
- Modify: `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`（purpose 三分支）
- Modify: `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx`（会员徽标按 purpose）

- [ ] **Step 1: PhoneUploadPage 增加 id_scan 分支**

现有二值逻辑（`:27` `const isPrintDoc = ...`、`:33` `const accept = isPrintDoc ? PRINT_DOC_ACCEPT : RESUME_ACCEPT`）改为：

```typescript
const purposeParam = hashParams.get('purpose')?.trim()
const isPrintDoc = purposeParam === 'print_doc'
const isIdPhoto = purposeParam === 'id_scan'
```

新增常量（`PRINT_DOC_ACCEPT` 旁）：

```typescript
const ID_PHOTO_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png'
```

```typescript
const accept = isIdPhoto ? ID_PHOTO_ACCEPT : isPrintDoc ? PRINT_DOC_ACCEPT : RESUME_ACCEPT
```

页面文案（找到现有按 `isPrintDoc` 切换标题/说明的位置，加 id_scan 分支）：标题「上传证件照片」、说明「请选择一张纯色底（白/蓝/红）的标准证件照片。照片仅用于本次排版打印，最迟 1 小时内自动删除，不长期保存。」

- [ ] **Step 2: UploadSessionQrPanel 会员徽标按 purpose**

`:241` 的固定徽标改为：

```tsx
{status?.mode === 'member' && (
  <span className="rounded-full bg-success-bg px-2.5 py-1 text-xs font-bold text-success-fg">
    {purpose === 'id_scan' ? '证件照短期保存，1 小时内自动删除' : '会员文件确认后归档'}
  </span>
)}
```

（`purpose` 已是组件 prop，默认 `'resume_upload'`，无需新 prop。）

- [ ] **Step 3: typecheck + lint**

Run: `pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/kiosk/src/pages/upload/
git commit -m "feat(kiosk): phone upload id_scan branch with honest privacy copy"
```

---

### Task 10: Kiosk idPhoto API 客户端 + 浏览器裁剪工具

**Files:**
- Create: `apps/kiosk/src/services/api/idPhoto.ts`
- Create: `apps/kiosk/src/pages/print-scan/idPhotoCrop.ts`

- [ ] **Step 1: API 客户端**（结构对照 `printConversion.ts`，同样的 envelope/错误处理）

```typescript
// apps/kiosk/src/services/api/idPhoto.ts
// 证件照前端 API 薄封装：POST /print/id-photo/layout、DELETE /print/id-photo/file/:fileId。
// 错误处理对齐同目录 printConversion.ts：ApiHttpError 保留后端 error.code 与 HTTP status。

import type { IdPhotoLayoutRequest, IdPhotoLayoutResponse } from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

async function request<T>(path: string, init: RequestInit, emptyCode: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init)
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
  if (!payload?.data) throw new ApiHttpError(emptyCode, '返回数据为空', res.status)
  return payload.data
}

export async function generateIdPhotoLayout(
  requestBody: IdPhotoLayoutRequest,
  options: { token: string | null; idempotencyKey: string },
): Promise<IdPhotoLayoutResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': options.idempotencyKey,
  }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  return request<IdPhotoLayoutResponse>('/print/id-photo/layout', {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  }, 'IDPHOTO_FAILED')
}

/** 手动删除（会员凭 token；游客凭 deleteToken，走请求体不进 URL）。幂等：已删除也返回成功。 */
export async function deleteIdPhotoFile(
  fileId: string,
  options: { token: string | null; deleteToken?: string | null },
): Promise<{ deleted: true }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  return request<{ deleted: true }>(`/print/id-photo/file/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(options.deleteToken ? { deleteToken: options.deleteToken } : {}),
  }, 'IDPHOTO_FAILED')
}

/** 原图 fileUrl（/api/v1/files/:id/content?...）→ 可 fetch 的完整地址。 */
export function resolveFileContentUrl(fileUrl: string): string {
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  return `${origin}${fileUrl}`
}
```

- [ ] **Step 2: 裁剪工具（纯浏览器，无第三方库）**

```typescript
// apps/kiosk/src/pages/print-scan/idPhotoCrop.ts
// 证件照浏览器内裁剪（设计 §一核心架构：服务端零原生解码，裁剪在浏览器沙箱完成；
// createImageBitmap 解码时现代 Chromium 自动应用 EXIF Orientation，canvas 重编码产物无 EXIF）。

import type { IdPhotoSpec } from '@ai-job-print/shared'

export interface CoverCrop {
  sx: number
  sy: number
  sw: number
  sh: number
}

/** 居中 cover 裁剪区域（与目标等比、取源图最大内接区域、居中）。 */
export function computeCoverCrop(srcW: number, srcH: number, targetW: number, targetH: number): CoverCrop {
  const targetRatio = targetW / targetH
  const srcRatio = srcW / srcH
  let sw: number
  let sh: number
  if (srcRatio > targetRatio) {
    sh = srcH
    sw = Math.round(srcH * targetRatio)
  } else {
    sw = srcW
    sh = Math.round(srcW / targetRatio)
  }
  return { sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh }
}

export type CropFailure = 'decode_failed' | 'resolution_too_low'

export interface CropSuccess {
  ok: true
  blob: Blob
  /** 裁剪区域相对目标像素的倍率；<2 时页面提示"打印可能不够清晰"（设计 §二.5） */
  scaleRatio: number
}

export interface CropError {
  ok: false
  reason: CropFailure
}

export async function cropToSpec(source: Blob, spec: IdPhotoSpec): Promise<CropSuccess | CropError> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch {
    return { ok: false, reason: 'decode_failed' }
  }
  try {
    const crop = computeCoverCrop(bitmap.width, bitmap.height, spec.widthPx, spec.heightPx)
    // 设计 §二.5：cropWidth ≥ targetWidth && cropHeight ≥ targetHeight，不足直接拒绝（放大必糊）。
    if (crop.sw < spec.widthPx || crop.sh < spec.heightPx) {
      return { ok: false, reason: 'resolution_too_low' }
    }
    const canvas = document.createElement('canvas')
    canvas.width = spec.widthPx
    canvas.height = spec.heightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, reason: 'decode_failed' }
    ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, spec.widthPx, spec.heightPx)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) return { ok: false, reason: 'decode_failed' }
    return { ok: true, blob, scaleRatio: crop.sw / spec.widthPx }
  } finally {
    bitmap.close()
  }
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @ai-job-print/kiosk typecheck`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/kiosk/src/services/api/idPhoto.ts apps/kiosk/src/pages/print-scan/idPhotoCrop.ts
git commit -m "feat(kiosk): id-photo api client and in-browser cover crop util"
```

---

### Task 11: IdPhotoPage 流程页 + 路由

**Files:**
- Create: `apps/kiosk/src/pages/print-scan/IdPhotoPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx:55/123` 附近（import + 路由）

- [ ] **Step 1: 页面组件**（视觉/结构对照 `ConvertImagesPage.tsx`；触控 ≥48px、主按钮 size="lg"）

```tsx
// apps/kiosk/src/pages/print-scan/IdPhotoPage.tsx
//
// 证件照打印（/print-scan/id-photo）。设计：docs/superpowers/specs/2026-07-12-id-photo-design.md
// 流程：选规格 → 本机/扫码取图 → 浏览器内 cover 裁剪+预览（原图不出浏览器，本机路径原图不上传）
//   → 上传裁剪产物(id_scan) → 生成 A4 整版排版 PDF → /print/confirm（证件照专用参数契约，固定彩色）。
// 隐私：裁剪产物与排版 PDF 高敏 1h TTL；打印建单后服务端自动删源；页面提供「立即删除照片」。

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import {
  ID_PHOTO_SPECS,
  makePrintParams,
  canCreateFormalPrintScanTask,
  type IdPhotoSpec,
} from '@ai-job-print/shared'
import { AlertCircleIcon, LoaderIcon, QrCodeIcon, TrashIcon, UploadIcon, UserSquareIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/api/files'
import { getConfiguredCapabilities } from '../../services/api/printScanCapabilities'
import { getTerminalId } from '../../services/api/screensaver'
import { deleteIdPhotoFile, generateIdPhotoLayout, resolveFileContentUrl } from '../../services/api/idPhoto'
import { cropToSpec } from './idPhotoCrop'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'

interface CroppedState {
  fileId: string
  fileAccessUrl: string
  previewUrl: string
  lowResolution: boolean
  /** 游客场景 layout 响应回填，手动删除用 */
  deleteToken?: string
  /** 扫码路径的原图 fileId（裁剪产物上传成功后即删原图，best-effort） */
  phoneOriginalFileId?: string
}

export function IdPhotoPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [unavailableNote, setUnavailableNote] = useState<string | null>(null)
  const [spec, setSpec] = useState<IdPhotoSpec>(ID_PHOTO_SPECS[0]!)
  const [copies, setCopies] = useState(1)
  const [cropped, setCropped] = useState<CroppedState | null>(null)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)

  useBusyLock(busy || generating || qrBusy)

  // 能力开关 fail-closed（设计 §4.8）：配置为非 available → 诚实不可用态；
  // 未配置 → 放行进入（生产 strict 模式由服务端 layout 门禁兜底拒绝）。
  useEffect(() => {
    let cancelled = false
    void getConfiguredCapabilities().then((map) => {
      if (cancelled) return
      const conf = map['id_photo']
      if (!conf) {
        setAvailable(true)
        return
      }
      const ok = canCreateFormalPrintScanTask(conf.status)
      setAvailable(ok)
      if (!ok) setUnavailableNote(conf.note ?? '本终端证件照服务未开放')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 离开页面 best-effort 清理预览对象 URL
  useEffect(() => {
    return () => {
      if (cropped?.previewUrl) URL.revokeObjectURL(cropped.previewUrl)
    }
  }, [cropped?.previewUrl])

  const resetPhoto = () => {
    if (cropped?.previewUrl) URL.revokeObjectURL(cropped.previewUrl)
    setCropped(null)
  }

  /** 核心：源 Blob → 浏览器裁剪 → 上传裁剪产物（id_scan）。原图不上传（本机路径）。 */
  const cropAndUpload = async (source: Blob, phoneOriginalFileId?: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await cropToSpec(source, spec)
      if (!result.ok) {
        setError(
          result.reason === 'resolution_too_low'
            ? `照片分辨率不足（该规格需至少 ${spec.widthPx}×${spec.heightPx}px 的有效区域），打印会模糊，请更换更清晰的照片`
            : '照片无法识别，请更换 JPG / PNG 格式的照片',
        )
        return
      }
      const file = new File([result.blob], `id-photo-crop-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const uploaded = await kioskUploadFile(file, 'id_scan', getToken())
      resetPhoto()
      setCropped({
        fileId: uploaded.fileId,
        fileAccessUrl: uploaded.signedUrl,
        previewUrl: URL.createObjectURL(result.blob),
        lowResolution: result.scaleRatio < 2,
        phoneOriginalFileId,
      })
      // 扫码路径：裁剪产物已入库，原图即刻删除（best-effort，1h TTL 兜底；设计 §二.6）
      if (phoneOriginalFileId) {
        void deleteIdPhotoFile(phoneOriginalFileId, { token: getToken() }).catch(() => undefined)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '照片处理失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (!['image/jpeg', 'image/png'].includes(selected.type)) {
      setError('仅支持 JPG / PNG 照片')
      return
    }
    await cropAndUpload(selected)
  }

  const handlePhoneUploaded = async (file: PhoneUploadedFile) => {
    setShowQr(false)
    if (!file.fileUrl) {
      setError('手机上传结果异常，请重试')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(resolveFileContentUrl(file.fileUrl))
      if (!res.ok) throw new Error('获取手机照片失败，请重新扫码上传')
      const blob = await res.blob()
      await cropAndUpload(blob, file.fileId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取手机照片失败')
      setBusy(false)
    }
  }

  const handleManualDelete = async () => {
    if (!cropped) return
    setBusy(true)
    try {
      await deleteIdPhotoFile(cropped.fileId, { token: getToken(), deleteToken: cropped.deleteToken })
      resetPhoto()
      setError(null)
    } catch {
      // 删除失败也清本地引用；服务端 1h TTL 兜底
      resetPhoto()
    } finally {
      setBusy(false)
    }
  }

  const handleGenerate = async () => {
    if (!cropped) return
    setGenerating(true)
    setError(null)
    try {
      const idempotencyKey = `idphoto-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const result = await generateIdPhotoLayout(
        {
          source: { fileId: cropped.fileId, fileAccessUrl: cropped.fileAccessUrl },
          specId: spec.specId,
          terminalId: getTerminalId() || 'kiosk-dev',
        },
        { token: getToken(), idempotencyKey },
      )
      if (result.sourceDeleteToken) {
        setCropped((prev) => (prev ? { ...prev, deleteToken: result.sourceDeleteToken } : prev))
      }
      // 设计 §六：证件照专用参数契约在此定死（/print/confirm 只展示不编辑）；固定彩色，不提供黑白。
      navigate('/print/confirm', {
        state: {
          file: {
            name: `证件照-${spec.label}-整版${result.layoutCount}张.pdf`,
            size: formatBytes(result.sizeBytes),
            pages: result.pages,
            fileId: result.fileId,
            fileUrl: result.printFileUrl,
            fileMd5: result.fileMd5,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({
            copies,
            color: 'color',
            scale: 'actual',
            duplex: 'single',
            orientation: 'portrait',
            paperSize: 'A4',
          }),
          source: 'document',
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
    } finally {
      setGenerating(false)
    }
  }

  if (available === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100">
          <UserSquareIcon className="h-10 w-10 text-neutral-400" />
        </div>
        <h1 className="mt-6 text-xl font-semibold text-neutral-900">证件照服务暂不可用</h1>
        <p className="mt-2 text-sm text-neutral-500">{unavailableNote}</p>
        <Button className="mt-8" size="lg" onClick={() => navigate('/print-scan')}>
          返回打印扫描服务
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="证件照打印"
        subtitle="常见规格 A4 整版排版，彩色激光打印"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/print-scan')}>
            返回打印扫描服务
          </Button>
        }
      />

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        {/* 设计 §九：隐私 + 能力 + 质量 + 规格四条诚实文案 */}
        <ComplianceBanner tone="success" title="隐私保护">
          证件照仅用于本次排版打印，最迟 1 小时内自动删除，不长期保存，不用于其他用途；本机选择的原始照片不会上传，仅裁剪结果用于生成打印文件。
        </ComplianceBanner>
        <ComplianceBanner tone="info">
          本服务不提供自动抠图/换底色，请上传纯色底（白/蓝/红）标准证件照片。彩色激光打印效果，适合临时应急使用，非照相馆冲印质量。各受理机构对照片可能有特殊要求，请以受理机构要求为准。
        </ComplianceBanner>

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">1. 选择规格</p>
          <div className="grid grid-cols-2 gap-3">
            {ID_PHOTO_SPECS.map((s) => (
              <button
                key={s.specId}
                type="button"
                onClick={() => {
                  setSpec(s)
                  resetPhoto()
                }}
                className={[
                  'flex min-h-[64px] flex-col items-center justify-center rounded-xl border-2 px-3 py-2',
                  spec.specId === s.specId ? 'border-primary-500 bg-primary-50' : 'border-neutral-200 bg-white',
                ].join(' ')}
              >
                <span className="text-base font-semibold text-neutral-900">{s.label}</span>
                <span className="text-xs text-neutral-500">
                  {s.widthMm}×{s.heightMm}mm
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">2. 上传照片（{spec.label}）</p>
          {cropped ? (
            <div className="flex items-center gap-4">
              <img
                src={cropped.previewUrl}
                alt="裁剪预览"
                className="h-40 rounded-lg border border-neutral-200 object-contain"
                style={{ aspectRatio: `${spec.widthPx} / ${spec.heightPx}` }}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm text-neutral-600">已按 {spec.label} 居中裁剪，请确认构图（人像应完整居中）。</p>
                {cropped.lowResolution && (
                  <p className="text-xs text-warning-fg">照片分辨率一般，打印可能不够清晰，建议更换更清晰的照片。</p>
                )}
                <Button size="lg" variant="secondary" disabled={busy} onClick={handleManualDelete}>
                  <TrashIcon className="mr-1.5 h-5 w-5" />
                  删除照片重新选择
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={handleLocalFile} />
              <Button size="lg" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
                {busy ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : <UploadIcon className="mr-1.5 h-5 w-5" />}
                本机上传照片
              </Button>
              <Button size="lg" variant="secondary" disabled={busy} onClick={() => setShowQr(true)}>
                <QrCodeIcon className="mr-1.5 h-5 w-5" />
                手机扫码上传
              </Button>
            </div>
          )}
        </Card>

        {showQr && !cropped && (
          <Card className="p-4">
            <UploadSessionQrPanel
              purpose="id_scan"
              title="手机扫码上传证件照"
              description="手机扫码上传一张纯色底标准证件照片，确认后一体机自动按所选规格裁剪。"
              confirmLabel="确认使用这张照片"
              onUploaded={handlePhoneUploaded}
              onBusyChange={setQrBusy}
            />
          </Card>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
            <AlertCircleIcon className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {cropped && (
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-neutral-700">3. 打印份数（每份 A4 整版）</p>
            <div className="flex items-center gap-4">
              <Button size="lg" variant="secondary" disabled={copies <= 1} onClick={() => setCopies((c) => Math.max(1, c - 1))}>
                −
              </Button>
              <span className="min-w-[48px] text-center text-xl font-semibold">{copies}</span>
              <Button size="lg" variant="secondary" disabled={copies >= 9} onClick={() => setCopies((c) => Math.min(9, c + 1))}>
                ＋
              </Button>
            </div>
          </Card>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/95 to-transparent px-6 pb-6 pt-10">
        <Button size="lg" className="pointer-events-auto w-full" disabled={!cropped || busy || generating} onClick={() => void handleGenerate()}>
          {generating ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : null}
          生成排版并去打印（彩色）
        </Button>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
```

（注意：`makePrintParams` 的 `duplex` 旧值 `'single'` 会被 normalize 成 `'simplex'`，与后端契约校验一致——见 `packages/shared/src/types/print.ts:95-105`。若 `ComplianceBanner` 无 `tone="info"` 变体或布局类名与仓库现状不符，以 `ConvertImagesPage.tsx` 实际用法为准调整。）

- [ ] **Step 2: 路由注册**

`apps/kiosk/src/routes/index.tsx`：import 区（:55 附近）加 `import { IdPhotoPage } from '../pages/print-scan/IdPhotoPage'`；路由区（:123 附近）加：

```tsx
      { path: 'print-scan/id-photo',     element: <IdPhotoPage /> },
```

- [ ] **Step 3: typecheck + lint**

Run: `pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/kiosk/src/pages/print-scan/IdPhotoPage.tsx apps/kiosk/src/routes/index.tsx
git commit -m "feat(kiosk): id-photo flow page (spec select, in-browser crop, layout, color print handoff)"
```

---

### Task 12: 入口接线（首页磁贴 / 服务中心卡片 / 删除旧说明页视图）

**Files:**
- Modify: `apps/kiosk/src/pages/home/HomePage.tsx:330`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx:100-109`
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx`（删 id-photo）

- [ ] **Step 1: HomePage 磁贴点亮**（磁贴无能力开关机制，流程页自身 fail-closed 兜底，与"格式转换"磁贴先例一致）：

```typescript
      { title: '证件照打印', icon: 'user', to: '/print-scan/id-photo' },
```

- [ ] **Step 2: PrintScanHomePage 卡片**（`available` 保持 `false` 默认——设计 §4.8 上线开关：真机彩色验收后 Admin 配置 `id_photo=available` 点亮；卡片默认展示「了解详情」进入流程页的不可用态）：

```typescript
  {
    key: 'id-photo',
    icon: UserSquareIcon,
    iconBg: 'bg-warning-bg',
    iconColor: 'text-warning-fg',
    title: '证件照',
    description: '常见规格证件照 A4 排版彩色打印',
    to: '/print-scan/id-photo',
    available: false,
  },
```

- [ ] **Step 3: PrintScanFeatureInfoPage 删除 id-photo**：`FeatureKey` 改 `type FeatureKey = 'sign'`；`FEATURES` 删除 `'id-photo'` 条目（连同其"6 寸相纸"承诺文案一并消失）；`isFeatureKey` 改 `return k === 'sign'`；删除不再使用的 `UserSquareIcon` import。

- [ ] **Step 4: typecheck + lint**

Run: `pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/pages/home/HomePage.tsx apps/kiosk/src/pages/print-scan/
git commit -m "feat(kiosk): wire id-photo entries; remove placeholder info view with photo-paper promise"
```

---

### Task 13: CI 注册 + 全量回归 + 浏览器走查

**Files:**
- Modify: `.github/workflows/ci.yml:187 与 :334`（两个 job 各加一行）

- [ ] **Step 1: 双 CI 注册**——两处 `verify:print-conversion` 行后各加：

```yaml
          pnpm --filter @ai-job-print/api verify:id-photo
```

- [ ] **Step 2: 全量回归**

Run:
```bash
pnpm --filter @ai-job-print/shared typecheck && \
pnpm --filter @ai-job-print/api typecheck && \
pnpm --filter @ai-job-print/kiosk typecheck && \
pnpm --filter @ai-job-print/admin typecheck && \
pnpm --filter @ai-job-print/kiosk lint && \
pnpm --filter @ai-job-print/api verify:id-photo && \
pnpm --filter @ai-job-print/api verify:print-jobs && \
pnpm --filter @ai-job-print/api verify:print-conversion && \
pnpm --filter @ai-job-print/api verify:upload-sessions && \
pnpm --filter @ai-job-print/api verify:materials-processing && \
pnpm --filter @ai-job-print/api verify:file-retention
```
Expected: 全绿。

- [ ] **Step 3: mock 模式浏览器走查**（前端 dev server，走查项对照设计 §十）：
  1. `/print-scan/id-photo` 直达可开、能力不可用态正常（mock 下 configured 为空 → 放行进入）
  2. 规格选择四规格可切换、切换后已选照片清空
  3. 本机上传一张竖拍手机照 → 裁剪预览方向正确（EXIF）、构图居中
  4. 上传低分辨率小图（如 100×100）→ 拒绝并给出规格像素提示
  5. 上传非图片 → 「仅支持 JPG / PNG 照片」
  6. 「删除照片重新选择」可用
  7. 份数 +/- 边界（1–9）
  8. 首页磁贴、`/print-scan` 卡片入口可达
  9. 生成排版在 mock 模式会走到 NETWORK_ERROR 提示（诚实报错即可）；完整生成→`/print/confirm` 链路在 http 模式（本地起 API + Redis + SQLite）复验一次，确认携带 `scale:'actual'` + 彩色参数
  10. 触控目标全部 ≥48px

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run verify:id-photo in both verify jobs"
```

---

### Task 14: 文档收口

**Files:**
- Modify: `docs/progress/current-progress.md`（新增条目）
- Modify: `docs/progress/next-tasks.md:134`（"首期证件复印与证件照"条目更新）
- Modify: `docs/product/user-data-flow-matrix.md` §3.4（证件照打印行）
- Modify: `docs/device/production-deployment-and-windows-host-checklist.md`（追加真机验收条目）

- [ ] **Step 1: current-progress.md** 按仓库现有条目格式新增：完成范围（前端裁剪架构 + `id_photo_print` purpose + 参数契约 + 服务端源删除 + OCR 隔离 + 扫码 id_scan + verify:id-photo 进双 CI）、验证级别（代码 + 本地 verify + mock 走查级；**未点亮**：待真机彩色验收后 Admin 配置 `id_photo=available`）、设计与评审出处（specs/2026-07-12-id-photo-design.md，含外部 Codex 评审吸收）。

- [ ] **Step 2: next-tasks.md:134** 该条目中"证件照支持上传照片、抠图、换底色、规格检测、排版 PDF 和打印"改为分阶段口径：

```markdown
- [ ] **首期证件复印与证件照**：证件复印支持身份证正反面 A4 合成，默认不长期保存；证件照 MVP（上传照片、规格检测、浏览器内裁剪、A4 整版排版 PDF、彩色打印、"采集→使用→删除→审计"）代码已完成（见 docs/superpowers/specs/2026-07-12-id-photo-design.md），待真机彩色出纸 + noscale 尺寸验收后由 Admin 配置 `id_photo=available` 点亮；**抠图/换底色为二期**（第三方云 API 路线，人脸照片出内网须独立隐私评审 + 页面明示 + 用户逐次同意，禁止静默混入）；身份证 / 证件照采集必须通过"采集 -> 使用 -> 删除 -> 审计"真机验收。
```

- [ ] **Step 3: user-data-flow-matrix.md §3.4** 证件照打印行更新：路由 `/print-scan/id-photo`，产生数据 `FileObject(id_scan 裁剪产物, id_photo_print 排版PDF)`、`PrintTask`，归属"我的文档（1 小时窗口）、打印订单"，状态"✅ 代码级闭环（前端裁剪+服务端排版+契约打印+自动删源+审计）；待真机彩色验收点亮"，缺口"真机彩色出纸 + noscale 实物量尺 + 隐私链路演练"。

- [ ] **Step 4: production checklist** 追加（按该文档现有清单格式）：

```markdown
### 证件照打印真机验收（功能点亮前置，设计 §六/§十）
- [ ] 彩色出纸：SumatraPDF `-print-settings color` 真机验证（黑白已验，彩色未验）
- [ ] 尺寸准确：`scale=actual(noscale)` 打印一寸整版，实物量尺 25×35mm ±1mm；超差先查打印机驱动缩放设置
- [ ] 隐私链路演练：扫码上传→裁剪→生成→打印→确认裁剪产物被服务端自动删除→1 小时后 cron 物理删除排版 PDF→审计四类事件（file.upload / id_photo.layout_generated / print_job.create / id_photo.source_deleted）齐全
- [ ] 建单后延迟 >30 分钟再 claim 的任务按"URL 过期/文件缺失"诚实失败（不误报打印成功）
- [ ] 验收通过后：Admin「打印扫描运维 → 设备能力」将该终端 `id_photo` 置 `available`，Kiosk 卡片点亮
```

- [ ] **Step 5: Commit**

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md docs/product/user-data-flow-matrix.md docs/device/production-deployment-and-windows-host-checklist.md
git commit -m "docs: id-photo implementation progress, staged scope, machine acceptance checklist"
```

---

## Self-Review 记录（计划自查已执行）

- **Spec 覆盖**：设计 §〇-§十二逐节对照——规格体系(T1)、purpose 全链条(T2)、删除 token(T3)、layout/删除端点+幂等强化+审计强一致+并发+门禁(T4/T5)、参数契约+服务端删源(T6)、OCR 隔离(T7)、扫码 id_scan+审计(T8/T9)、前端裁剪+页面+入口(T10/T11/T12)、验证计划(T5/T6/T7/T8/T13)、真机验收清单+文档(T14)。设计 §六"claim 时重签 URL"明确列为打印域独立后续任务，不在本计划范围。
- **占位符扫描**：无 TBD/TODO；Task 5 夹具与 Task 7/8 的 verify 追加以"复制既有仓库文件的具体函数/用例"方式给出精确落点（非跨任务引用）。
- **类型一致性**：`IdPhotoLayoutResponse`/`ID_PHOTO_SPECS`/`computeGrid`/`signIdPhotoDeleteToken` 等名称在 T1/T3/T4/T5/T10/T11 间一致；后端契约字段 `scale/colorMode/duplex/paperSize` 与前端 `makePrintParams` 输入（`color:'color'`、`duplex:'single'` 经 normalize）已对齐。

## 执行前提醒

- 每个任务完成即 commit；任何 verify 失败先修再进下一任务。
- 实现阶段**禁止偏离**设计中的隐私契约（零服务端原生解码、`id_photo_print` 锁定短期、OCR 隔离、删除 token 不可互换）与打印参数契约（`scale:'actual'` 等五项）。
- 若实现中发现设计与代码现实冲突，停下更新设计文档并在 PR 记录，不静默绕过。
