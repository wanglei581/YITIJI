import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { FilesService } from '../files/files.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import { signFileUrl } from '../files/signing'
import type { FilePurpose } from '../files/file.types'
import type { CreateScanTaskDto } from './dto/create-scan-task.dto'

/**
 * 契约本地副本。
 *
 * **契约源**:packages/shared/src/types/scanTask.ts
 *
 * 为什么不直接 import @ai-job-print/shared:见 files/file.types.ts 顶部说明
 * （services/api 走 commonjs + node moduleResolution，packages/shared 是
 * ESM-only，两者互操作复杂，本仓库既有惯例是本地副本化 + SSOT 注释）。
 *
 * 任何字段变更必须同时改两处:
 *   1. packages/shared/src/types/scanTask.ts(前端 SSOT)
 *   2. 本文件(后端副本)
 */
export type ScanType = 'resume' | 'id' | 'document'
export type ScanTaskStatus = 'waiting' | 'matched' | 'completed' | 'failed' | 'expired' | 'cancelled'

const SCAN_TASK_TTL_MS = 10 * 60 * 1000
/** 建档后签发的内容 URL 有效期，与打印/上传会话链路同一惯例（30 分钟）。 */
const SCAN_FILE_URL_TTL_MS = 30 * 60 * 1000

const SCAN_TYPE_TO_PURPOSE: Record<ScanType, FilePurpose> = {
  resume: 'resume_scan',
  id: 'id_scan',
  document: 'print_doc',
}

// 面向用户的失败原因必须是白名单文案，绝不透出内部错误细节（对齐 print-jobs.service.ts 同类做法）。
const USER_FACING_SCAN_ERROR: Record<string, string> = {
  SCAN_UPLOAD_FAILED: '扫描文件处理失败，请重新扫描',
  // B1-5：ScanTaskReaperTask 收敛卡在 'matched' 状态太久的任务时写入的 errorCode，
  // 必须在这里登记白名单文案，否则 getStatus() 会把它 fallback 成通用的
  // '扫描处理失败，请重试'，用户看不到"超时未完成"这个更准确的原因。
  SCAN_MATCHED_TIMEOUT: '扫描处理超时未完成',
}

const SCAN_TYPE_INSTRUCTIONS: Record<ScanType, string[]> = {
  resume: [
    '将简历原件正面朝上放入打印机自动进纸器（或正面朝下放上玻璃板）',
    '在打印机操作面板选择"扫描"功能',
    '选择黑白或彩色（简历建议黑白，文字更清晰）',
    '按下开始扫描；完成后回到一体机等待识别',
  ],
  id: [
    '将证件正面朝下放在打印机玻璃板中央',
    '在打印机操作面板选择"扫描"功能，分辨率建议 300 DPI',
    '按下开始扫描；如需正反面，扫完一面后翻面重复',
    '完成后回到一体机等待识别',
  ],
  document: [
    '将文件放入打印机自动进纸器（多页）或玻璃板（单页）',
    '在打印机操作面板选择"扫描"功能',
    '按下开始扫描；完成后回到一体机等待识别',
  ],
}

export interface ScanTaskFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  fileUrl: string
}

export interface ScanTaskStatusResult {
  scanTaskId: string
  status: ScanTaskStatus
  scanType: ScanType
  file: ScanTaskFileView | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
}

/**
 * 判断是否命中 ScanTask 的活跃会话唯一约束（Prisma P2002）。
 *
 * `ScanTask` 模型目前只有一个数据库层唯一约束——B1-2 加的 partial unique index
 * `ScanTask_terminalId_active_unique`（同一 terminalId 同时只能有一条 waiting/matched
 * 记录，见 schema.prisma 里 ScanTask 模型上的注释）——create() 的 insert 里没有其它
 * 可能触发唯一冲突的列，因此不需要像 order-status.service.ts 的
 * isPickupCodeUniqueConflict() 那样再去比对 meta.target 区分多个候选唯一约束。
 */
function isScanTaskActiveSessionConflict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * B1-4：getStatus()/cancel() 统一要求 controlToken（会员+游客一视同仁，纵深防御
 * 叠加在 endUserId 校验之上，而不是替代它）。
 *
 * 与本仓库既有惯例同款（如 job-fit.service.ts 的 tokenMatches() / mock-interview.service.ts
 * 的 verifyToken()）：先对调用方传入的明文 token 做 sha256，转成 Buffer 后与存的 hash
 * 做 timingSafeEqual；长度不一致时短路返回 false —— 绝不能让 timingSafeEqual 因为两个
 * Buffer 长度不同而抛异常（那样反而会把"长度不同"这个信息通过异常/耗时差异暴露出去，
 * 且会变成未处理异常而不是可控的 403）。
 */
function timingSafeEqualHex(token: string | undefined, expectedHash: string | null | undefined): boolean {
  if (!token || !expectedHash) return false
  const actual = Buffer.from(createHash('sha256').update(token).digest('hex'), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

@Injectable()
export class ScanTasksService {
  private readonly logger = new Logger(ScanTasksService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly capabilities: TerminalCapabilitiesService,
  ) {}

  async create(
    dto: CreateScanTaskDto,
    endUserId: string | null,
  ): Promise<{ scanTaskId: string; controlToken: string; expiresAt: string; instructions: string[] }> {
    const terminalRef = dto.terminalId.trim()
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
      select: { id: true, enabled: true },
    })
    if (!terminal) {
      throw new BadRequestException({ error: { code: 'SCAN_TERMINAL_NOT_FOUND', message: '目标终端不存在' } })
    }
    if (!terminal.enabled) {
      throw new BadRequestException({ error: { code: 'SCAN_TERMINAL_DISABLED', message: '目标终端已停用' } })
    }

    // Task 10 服务端能力门禁：管理员把该终端 scan 配为非 available 时拒绝创建
    // （未配置行放行，见 TerminalCapabilitiesService.assertUserTaskAllowed）。
    await this.capabilities.assertUserTaskAllowed(terminal.id, 'scan')

    // 与 mock-interview.service.ts / materials.service.ts 的匿名 accessToken 同款惯例：
    // randomBytes(24) 铸 192-bit 随机 token，DB 只存 sha256 hash，明文只在本次响应里返回一次。
    const controlToken = randomBytes(24).toString('hex')
    const controlTokenHash = createHash('sha256').update(controlToken).digest('hex')

    const expiresAt = new Date(Date.now() + SCAN_TASK_TTL_MS)
    let task: { id: string }
    try {
      task = await this.prisma.scanTask.create({
        data: {
          terminalId: terminal.id,
          scanType: dto.scanType,
          endUserId,
          expiresAt,
          controlTokenHash,
        },
        select: { id: true },
      })
    } catch (e) {
      if (isScanTaskActiveSessionConflict(e)) {
        // B1-2 的 partial unique index 命中：该终端已有一个 waiting/matched 中的会话。
        throw new ConflictException({
          error: { code: 'SCAN_TERMINAL_BUSY', message: '该终端当前有正在进行的扫描，请稍后重试或联系工作人员' },
        })
      }
      throw e
    }

    return {
      scanTaskId: task.id,
      controlToken,
      expiresAt: expiresAt.toISOString(),
      instructions: SCAN_TYPE_INSTRUCTIONS[dto.scanType],
    }
  }

  async getStatus(
    scanTaskId: string,
    endUserId: string | null,
    controlToken: string | undefined,
  ): Promise<ScanTaskStatusResult> {
    const task = await this.prisma.scanTask.findUnique({ where: { id: scanTaskId } })
    if (!task) {
      throw new NotFoundException({ error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' } })
    }
    // 会员 + 游客一视同仁：controlToken 是纵深防御的第二层校验，叠加在下面的
    // endUserId 归属校验之上（不是替代它）。历史行（B1-1 迁移前创建，
    // controlTokenHash 为 null）一律拒绝——旧任务本来就该在几分钟内自然过期，
    // 拒绝比"放行一个没有 token 保护的旧任务"更安全。
    if (!task.controlTokenHash || !controlToken || !timingSafeEqualHex(controlToken, task.controlTokenHash)) {
      throw new ForbiddenException({ error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权查看该扫描任务' } })
    }
    if (task.endUserId && task.endUserId !== endUserId) {
      throw new ForbiddenException({ error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权查看该扫描任务' } })
    }

    const effectiveStatus = this.effectiveStatus(task.status, task.expiresAt)
    if (effectiveStatus === 'expired' && task.status === 'waiting') {
      // CAS：只在仍是 waiting 时落盘过期状态，避免与并发的 cancel()/deliverScanFile() 竞态时
      // 用无条件 update 把已经被其它请求改成 cancelled/matched/completed 的行覆盖回 expired。
      // 返回给调用方的 effectiveStatus 已经是按 expiresAt 纯计算得出，不依赖这次落盘是否成功。
      await this.prisma.scanTask.updateMany({ where: { id: scanTaskId, status: 'waiting' }, data: { status: 'expired' } })
    }

    let file: ScanTaskFileView | null = null
    if (effectiveStatus === 'completed' && task.fileId) {
      const fileObject = await this.prisma.fileObject.findUnique({ where: { id: task.fileId } })
      if (fileObject && !fileObject.deletedAt) {
        const signed = signFileUrl(fileObject.id, SCAN_FILE_URL_TTL_MS)
        file = {
          fileId: fileObject.id,
          filename: fileObject.filename,
          sizeBytes: fileObject.sizeBytes,
          mimeType: fileObject.mimeType,
          sha256: fileObject.sha256,
          fileUrl: signed.url,
        }
      }
    }

    return {
      scanTaskId: task.id,
      status: effectiveStatus as ScanTaskStatus,
      scanType: task.scanType as ScanType,
      file,
      errorCode: task.errorCode,
      errorMessage: task.errorCode ? (USER_FACING_SCAN_ERROR[task.errorCode] ?? '扫描处理失败，请重试') : null,
      expiresAt: task.expiresAt.toISOString(),
    }
  }

  async cancel(
    scanTaskId: string,
    endUserId: string | null,
    controlToken: string | undefined,
  ): Promise<{ scanTaskId: string; status: 'cancelled' }> {
    const task = await this.prisma.scanTask.findUnique({ where: { id: scanTaskId } })
    if (!task) {
      throw new NotFoundException({ error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' } })
    }
    // 同 getStatus()：controlToken 校验叠加在 endUserId 校验之上，会员+游客一视同仁；
    // 历史行（controlTokenHash 为 null）一律拒绝。
    if (!task.controlTokenHash || !controlToken || !timingSafeEqualHex(controlToken, task.controlTokenHash)) {
      throw new ForbiddenException({ error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权取消该扫描任务' } })
    }
    if (task.endUserId && task.endUserId !== endUserId) {
      throw new ForbiddenException({ error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权取消该扫描任务' } })
    }
    if (task.status === 'completed') {
      throw new BadRequestException({ error: { code: 'SCAN_TASK_ALREADY_COMPLETED', message: '任务已完成，无法取消' } })
    }
    const cancelled = await this.prisma.scanTask.updateMany({
      where: { id: scanTaskId, status: { in: ['waiting', 'matched'] } },
      data: { status: 'cancelled' },
    })
    if (cancelled.count === 0) {
      // 状态在读取之后、CAS 之前发生了变化（多半是并发投递刚好完成），
      // 不能盲目宣称已取消——重新读取真实状态并诚实报告。
      const latest = await this.prisma.scanTask.findUnique({ where: { id: scanTaskId } })
      if (latest?.status === 'completed') {
        throw new BadRequestException({ error: { code: 'SCAN_TASK_ALREADY_COMPLETED', message: '任务已完成，无法取消' } })
      }
      throw new ConflictException({
        error: { code: 'SCAN_TASK_CANCEL_CONFLICT', message: '任务状态已变化，取消失败，请刷新重试' },
      })
    }
    return { scanTaskId, status: 'cancelled' }
  }

  /**
   * Agent 投递入口：找该终端最早一条仍在 waiting 且未过期的任务，建 FileObject，
   * 标记任务完成。找不到匹配任务时抛 409，调用方（Agent）据此把文件移入隔离目录，
   * 绝不猜测归属。
   */
  async deliverScanFile(args: {
    terminalId: string
    buffer: Buffer
    filename: string
    mimeType: string
  }): Promise<{ scanTaskId: string; fileId: string }> {
    const now = new Date()
    const task = await this.prisma.scanTask.findFirst({
      where: { terminalId: args.terminalId, status: 'waiting', expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
    })
    if (!task) {
      throw new ConflictException({ error: { code: 'NO_WAITING_SCAN_TASK', message: '没有匹配的等待中扫描任务' } })
    }

    // CAS：先把任务标记为 matched，防止同一文件的重复投递请求并发匹配到同一任务。
    const claimed = await this.prisma.scanTask.updateMany({
      where: { id: task.id, status: 'waiting' },
      data: { status: 'matched', matchedFileMtime: now },
    })
    if (claimed.count === 0) {
      throw new ConflictException({ error: { code: 'NO_WAITING_SCAN_TASK', message: '没有匹配的等待中扫描任务' } })
    }

    try {
      const purpose = SCAN_TYPE_TO_PURPOSE[task.scanType as ScanType]
      const uploaded = await this.files.upload({
        buffer: args.buffer,
        filename: args.filename,
        mimeType: args.mimeType,
        purpose,
        uploaderId: null,
        endUserId: task.endUserId,
      })
      const completed = await this.prisma.scanTask.updateMany({
        where: { id: task.id, status: 'matched' },
        data: { status: 'completed', fileId: uploaded.fileId },
      })
      if (completed.count === 0) {
        // 任务在上传期间被取消（或已被其它方式改变状态）。文件已经真实上传成功，
        // 但不能把它挂到一个已经不再 "matched" 的任务上——诚实记录，不假装成功。
        // B1-6：不再静默留下孤儿文件——用 FilesService.systemDelete() 补偿删除
        // （绕过 canAccessFile() 的用户权限校验，专给系统自身产生的清理场景用）。
        // 补偿删除本身失败（例如文件已经被其它路径删掉）不能打断这里原本要走的
        // 取消响应流程，只降级为一条 warn，不 rethrow。
        try {
          await this.files.systemDelete(uploaded.fileId, 'ScanTask cancelled during upload, compensating orphaned file')
          this.logger.log(
            `scan task ${task.id} was no longer 'matched' after upload completed (likely cancelled concurrently); orphaned file ${uploaded.fileId} deleted via compensating systemDelete()`,
          )
        } catch (cleanupError) {
          const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          this.logger.warn(
            `scan task ${task.id}: compensating systemDelete() failed for orphaned file ${uploaded.fileId}: ${cleanupMessage}`,
          )
        }
        throw new ConflictException({
          error: { code: 'SCAN_TASK_STATE_CHANGED', message: '扫描任务状态已变化，请重新发起扫描' },
        })
      }
      return { scanTaskId: task.id, fileId: uploaded.fileId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.prisma.scanTask.updateMany({
        where: { id: task.id, status: 'matched' },
        data: { status: 'failed', errorCode: 'SCAN_UPLOAD_FAILED', errorMessage: message },
      })
      throw error
    }
  }

  private effectiveStatus(status: string, expiresAt: Date): string {
    if (status === 'waiting' && expiresAt.getTime() <= Date.now()) return 'expired'
    return status
  }
}
