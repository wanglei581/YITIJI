import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import type { FeedbackCategory, FeedbackStatus } from './member-feedback.types'
import { FEEDBACK_CATEGORIES } from './dto/member-feedback.dto'
import {
  KIOSK_FEEDBACK_ISSUE_MAP,
  KIOSK_FEEDBACK_SATISFACTION_LABEL,
  type CreateKioskFeedbackDto,
  type KioskFeedbackIssueCode,
  type KioskFeedbackSatisfaction,
} from './dto/kiosk-feedback.dto'
import { detectKioskFeedbackPii, sanitizeKioskFeedbackText } from './kiosk-feedback-text'

/** 匿名工单的 submitterType 取值，后台据此与会员工单分开处置。 */
export const ANONYMOUS_KIOSK_SUBMITTER = 'anonymous_kiosk'

/**
 * 限流阈值（按终端计，落库计数 → 跨实例、跨重启一致）。
 *
 * 为什么是这两档：一体机同一时刻只服务一个人，一次打印会话是分钟级；
 * 真实用户一次会话最多提 1–2 条。
 *   - 5 条 / 10 分钟：容得下一个真被卡住的用户连提几条不同问题，再加下一位用户，
 *     但堵死「一个人站在机器前刷单」。
 *   - 20 条 / 60 分钟：设备真坏时一小时内约 20 位用户各提一条仍能进来，
 *     同时给持续滥用（前端死循环重试、现场恶意刷）一个硬顶。
 * 只统计**真正建单**的行：命中幂等的重复提交不建行，因此不消耗额度。
 */
export const KIOSK_FEEDBACK_RATE_LIMITS = [
  { windowMs: 10 * 60_000, max: 5 },
  { windowMs: 60 * 60_000, max: 20 },
] as const

/**
 * 幂等窗口。同终端 + 同 issueCode + 同满意度 + 同关联任务 + 同文本
 * 在窗口内视为同一次提交（双击、断网重试、页面重复挂载）。
 * 检查当前桶与上一桶，避免整点切桶时把一次双击拆成两单。
 */
export const KIOSK_FEEDBACK_DEDUP_WINDOW_MS = 10 * 60_000

export interface KioskFeedbackReceipt {
  ticketId: string
  submitterType: typeof ANONYMOUS_KIOSK_SUBMITTER
  category: FeedbackCategory
  issueCode: KioskFeedbackIssueCode | null
  satisfaction: KioskFeedbackSatisfaction | null
  status: FeedbackStatus
  /** true = 命中幂等窗口，返回的是已存在的工单，本次未新建。 */
  deduplicated: boolean
  createdAt: string
}

/** 与会员端一致的合规文案红线（CLAUDE.md §2 禁用投递/招聘闭环表述）。 */
const FORBIDDEN_RECRUITING_COPY =
  /一键投递|立即投递|平台投递|面试邀约|录用通知|Offer|候选人推荐|企业筛选|收取简历|投递结果|预约结果/i

function badRequest(code: string, message: string): never {
  throw new BadRequestException({ error: { code, message } })
}

/**
 * 一体机匿名反馈提交面。
 *
 * 与 MemberFeedbackService 刻意分开：会员面有账号归属、可读列表、可追加回复、可关单；
 * 匿名面只有「提交」一个动作，没有任何读取入口 —— 匿名调用方不应拿到可枚举的工单读能力。
 * 两者共用 FeedbackTicket 表，靠 submitterType 区分。
 */
@Injectable()
export class KioskFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(dto: CreateKioskFeedbackDto): Promise<KioskFeedbackReceipt> {
    const terminalId = dto.terminalId.trim()
    if (!terminalId) badRequest('KIOSK_FEEDBACK_TERMINAL_REQUIRED', '缺少终端标识')

    // 1) 至少要说明一件事：报障或评分。两者都缺 = 空提交，不建单。
    if (!dto.issueCode && !dto.satisfaction) {
      badRequest('KIOSK_FEEDBACK_EMPTY', '请选择问题类型或满意度')
    }

    // 2) 自由文本清洗 + PII 拒绝 + 合规文案红线（纯计算，先做，不打 DB）。
    const content = this.resolveContent(dto)

    // 3) 分类由 issueCode 映射得到；再对既有枚举做一次防御性校验，
    //    映射表写错也不会把非法 category 落库。
    const category = dto.issueCode ? KIOSK_FEEDBACK_ISSUE_MAP[dto.issueCode].category : 'general'
    if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
      badRequest('FEEDBACK_CATEGORY_INVALID', '反馈分类不支持')
    }

    // 4) 终端必须真实存在。否则攻击者可以每次换一个 terminalId 绕开按终端限流。
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId }, select: { id: true } })
    if (!terminal) badRequest('KIOSK_FEEDBACK_TERMINAL_INVALID', '终端不存在')

    // 5) 关联任务必须属于本终端 —— 防止拿别人的任务 ID 刷单 / 探测他人任务是否存在。
    await this.assertTaskBelongsToTerminal(dto, terminalId)

    // 6) 幂等：先于限流判定，否则一次双击在额度用尽时会变成 429 而不是回原单。
    const dedup = this.buildDedupKeys(dto, terminalId, content)
    const existing = await this.prisma.feedbackTicket.findFirst({
      where: { dedupKey: { in: dedup.lookupKeys } },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return this.toReceipt(existing, dto.issueCode ?? null, true)

    // 7) 限流。
    await this.assertWithinRateLimit(terminalId)

    // 8) 建单。并发下同一 dedupKey 由 UNIQUE 约束收敛，P2002 回落到已有工单。
    try {
      const row = await this.prisma.feedbackTicket.create({
        data: {
          endUserId: null,
          submitterType: ANONYMOUS_KIOSK_SUBMITTER,
          terminalId,
          relatedPrintTaskId: dto.relatedPrintTaskId?.trim() || null,
          relatedScanTaskId: dto.relatedScanTaskId?.trim() || null,
          category,
          title: this.buildTitle(dto),
          content,
          satisfaction: dto.satisfaction ?? null,
          dedupKey: dedup.writeKey,
          contactPhoneEnc: null,
        },
      })
      return this.toReceipt(row, dto.issueCode ?? null, false)
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const raced = await this.prisma.feedbackTicket.findFirst({
        where: { dedupKey: { in: dedup.lookupKeys } },
        orderBy: { createdAt: 'desc' },
      })
      if (!raced) throw error
      return this.toReceipt(raced, dto.issueCode ?? null, true)
    }
  }

  /**
   * 自由文本：可选。用户不写时用封闭词表的标准标签兜底，
   * 不编造内容，也不留空（FeedbackTicket.content 非空）。
   */
  private resolveContent(dto: CreateKioskFeedbackDto): string {
    const raw = dto.content ?? ''
    const cleaned = sanitizeKioskFeedbackText(raw)
    if (cleaned) {
      const pii = detectKioskFeedbackPii(cleaned)
      // 只回规则名，绝不回显命中的原文片段。
      if (pii) badRequest('KIOSK_FEEDBACK_PII_REJECTED', `反馈内容不能包含个人信息（${pii.rule}），请删除后重试`)
      if (FORBIDDEN_RECRUITING_COPY.test(cleaned)) {
        badRequest('FEEDBACK_COPY_FORBIDDEN', '反馈内容不能包含招聘流程或结果承诺')
      }
      return cleaned
    }
    return this.buildTitle(dto) ?? '一体机匿名反馈'
  }

  private buildTitle(dto: CreateKioskFeedbackDto): string | null {
    const parts: string[] = []
    if (dto.issueCode) parts.push(KIOSK_FEEDBACK_ISSUE_MAP[dto.issueCode].label)
    if (dto.satisfaction) parts.push(`满意度：${KIOSK_FEEDBACK_SATISFACTION_LABEL[dto.satisfaction]}`)
    return parts.length ? parts.join(' · ') : null
  }

  private async assertTaskBelongsToTerminal(dto: CreateKioskFeedbackDto, terminalId: string): Promise<void> {
    const printTaskId = dto.relatedPrintTaskId?.trim()
    if (printTaskId) {
      const task = await this.prisma.printTask.findFirst({
        where: { id: printTaskId, terminalId },
        select: { id: true },
      })
      // 统一错误码：不区分「不存在」与「属于别的终端」，避免变成跨终端任务探测器。
      if (!task) badRequest('KIOSK_FEEDBACK_PRINT_TASK_INVALID', '关联打印任务不属于本终端')
    }
    const scanTaskId = dto.relatedScanTaskId?.trim()
    if (scanTaskId) {
      const task = await this.prisma.scanTask.findFirst({
        where: { id: scanTaskId, terminalId },
        select: { id: true },
      })
      if (!task) badRequest('KIOSK_FEEDBACK_SCAN_TASK_INVALID', '关联扫描任务不属于本终端')
    }
  }

  private async assertWithinRateLimit(terminalId: string): Promise<void> {
    const now = Date.now()
    for (const { windowMs, max } of KIOSK_FEEDBACK_RATE_LIMITS) {
      const used = await this.prisma.feedbackTicket.count({
        where: {
          submitterType: ANONYMOUS_KIOSK_SUBMITTER,
          terminalId,
          createdAt: { gte: new Date(now - windowMs) },
        },
      })
      if (used >= max) {
        throw new HttpException(
          {
            error: {
              code: 'KIOSK_FEEDBACK_RATE_LIMITED',
              message: '该设备反馈提交过于频繁，请稍后再试或联系现场工作人员',
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
    }
  }

  /**
   * 幂等键：sha256(终端|issueCode|满意度|关联任务|文本摘要|时间桶)。
   * lookupKeys 含当前桶与上一桶（滑窗近似）；写入只用当前桶，
   * 这样 UNIQUE 约束在并发下仍然是单点收敛。
   */
  private buildDedupKeys(
    dto: CreateKioskFeedbackDto,
    terminalId: string,
    content: string,
  ): { writeKey: string; lookupKeys: string[] } {
    const bucket = Math.floor(Date.now() / KIOSK_FEEDBACK_DEDUP_WINDOW_MS)
    const base = [
      ANONYMOUS_KIOSK_SUBMITTER,
      terminalId,
      dto.issueCode ?? '',
      dto.satisfaction ?? '',
      dto.relatedPrintTaskId?.trim() ?? '',
      dto.relatedScanTaskId?.trim() ?? '',
      createHash('sha256').update(content).digest('hex'),
    ].join('|')
    const keyFor = (b: number) => createHash('sha256').update(`${base}|${b}`).digest('hex')
    return { writeKey: keyFor(bucket), lookupKeys: [keyFor(bucket), keyFor(bucket - 1)] }
  }

  private toReceipt(
    row: { id: string; category: string; status: string; satisfaction: string | null; createdAt: Date },
    issueCode: KioskFeedbackIssueCode | null,
    deduplicated: boolean,
  ): KioskFeedbackReceipt {
    return {
      ticketId: row.id,
      submitterType: ANONYMOUS_KIOSK_SUBMITTER,
      category: row.category as FeedbackCategory,
      issueCode,
      satisfaction: (row.satisfaction as KioskFeedbackSatisfaction | null) ?? null,
      status: row.status as FeedbackStatus,
      deduplicated,
      createdAt: row.createdAt.toISOString(),
    }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}
