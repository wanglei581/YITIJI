import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  auditActionFor,
  parseAlertAction,
  parseSilenceDuration,
  parseSubjectKey,
  resolveHandlingState,
  SILENCE_DURATIONS,
  storedAction,
  type AlertDispositionAction,
  type AlertHandlingState,
  type SilenceDuration,
} from './derived-alert-identity'
import { resolveDerivedAlert } from './derived-alerts'

const NOTE_MAX = 200

export interface AlertDispositionResult {
  subjectKey: string
  episodeToken: string
  action: AlertDispositionAction
  conditionState: 'firing'
  /** 由 resolveHandlingState 算出,保证与随后 GET 看到的状态一致。 */
  handlingState: AlertHandlingState
  silencedUntil: string | null
  note: string | null
  idempotent: boolean
  at: string
}

@Injectable()
export class AdminAlertActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async dispose(
    body: { subjectKey?: unknown; episodeToken?: unknown; action?: unknown; duration?: unknown; note?: unknown },
    operatorId: string,
  ): Promise<AlertDispositionResult> {
    const action = parseAlertAction(body.action)
    if (!action) {
      throw new BadRequestException({
        error: { code: 'ALERT_ACTION_INVALID', message: 'action 必须是 acknowledge / silence / close / reopen' },
      })
    }
    const parsedKey = typeof body.subjectKey === 'string' ? parseSubjectKey(body.subjectKey) : null
    if (!parsedKey) {
      throw new BadRequestException({
        error: { code: 'ALERT_SUBJECT_INVALID', message: 'subjectKey 必须是 type:id' },
      })
    }
    const episodeToken = typeof body.episodeToken === 'string' ? body.episodeToken.trim() : ''
    if (!episodeToken) {
      throw new BadRequestException({
        error: { code: 'ALERT_EPISODE_REQUIRED', message: '必须带上当前 episodeToken，避免确认打到另一轮故障' },
      })
    }
    let duration: SilenceDuration | null = null
    if (action === 'silence') {
      duration = parseSilenceDuration(body.duration)
      if (!duration) {
        throw new BadRequestException({
          error: { code: 'ALERT_SILENCE_DURATION_INVALID', message: '静默必须指定 duration=1h|4h|24h' },
        })
      }
    }
    const note = parseNote(body.note)

    const operator = await this.prisma.user.findUnique({
      where: { id: operatorId },
      select: { id: true, role: true, enabled: true },
    })
    if (!operator || operator.role !== 'admin' || !operator.enabled) {
      throw new ForbiddenException({
        error: { code: 'ADMIN_OPERATOR_REQUIRED', message: '仅已启用的管理员可处理告警' },
      })
    }

    const now = new Date()
    // 单条正向查证,不扫列表:列表有物化上限,用列表判定会让被截断的告警
    // 变成「查无此条」,操作员既看不到也处置不了(M1)。
    const current = await resolveDerivedAlert(this.prisma, parsedKey.type, parsedKey.subjectId, now)
    if (!current) {
      throw new NotFoundException({
        error: { code: 'ALERT_NOT_FIRING', message: '该告警当前未在发生，不能对其写入处理态' },
      })
    }
    if (current.episodeToken !== episodeToken) {
      throw new ConflictException({
        error: { code: 'ALERT_EPISODE_CHANGED', message: '告警已换成新一轮故障，请刷新后再处理' },
      })
    }

    const stored = storedAction(action)
    const silencedUntil = action === 'silence' && duration
      ? new Date(now.getTime() + SILENCE_DURATIONS[duration])
      : null
    const existing = await this.prisma.alertDisposition.findUnique({
      where: { subjectKey: current.subjectKey },
    })
    // 重复点同一个动作不再写库、不再多写一条审计。
    // reopen 的幂等条件是「现在已经是待处理」——包括从来没被处置过的情况,
    // 那种情况下不该为了一次无操作凭空造一行处置记录。
    const alreadyApplied = action === 'reopen'
      ? resolveHandlingState(existing, current.episodeToken, now) === 'open'
      : Boolean(
        existing
        && existing.recoveredAt === null
        && existing.episodeToken === current.episodeToken
        && existing.action === stored
        && (stored !== 'silenced' || (existing.silencedUntil !== null && existing.silencedUntil.getTime() > now.getTime())),
      )
    if (alreadyApplied) {
      return {
        subjectKey: current.subjectKey,
        episodeToken: current.episodeToken,
        action: stored,
        conditionState: 'firing',
        handlingState: resolveHandlingState(existing, current.episodeToken, now),
        silencedUntil: existing?.silencedUntil ? existing.silencedUntil.toISOString() : null,
        note: existing?.note ?? null,
        idempotent: true,
        at: (existing?.updatedAt ?? now).toISOString(),
      }
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.alertDisposition.upsert({
        where: { subjectKey: current.subjectKey },
        create: {
          subjectKey: current.subjectKey,
          alertType: current.type,
          subjectId: current.subjectId,
          episodeToken: current.episodeToken,
          action: stored,
          actorId: operatorId,
          note,
          silencedUntil,
          recoveredAt: null,
        },
        update: {
          alertType: current.type,
          subjectId: current.subjectId,
          episodeToken: current.episodeToken,
          action: stored,
          actorId: operatorId,
          note,
          silencedUntil,
          recoveredAt: null,
        },
      })
      await this.audit.writeRequired(tx, {
        actorId: operatorId,
        actorRole: 'admin',
        action: auditActionFor(action),
        targetType: 'derived_alert',
        targetId: current.subjectKey,
        payload: {
          alertType: current.type,
          subjectId: current.subjectId,
          episodeToken: current.episodeToken,
          action: stored,
          previousAction: existing?.action ?? null,
          silencedUntil: silencedUntil ? silencedUntil.toISOString() : null,
          note,
        },
      })
      return saved
    })

    return {
      subjectKey: current.subjectKey,
      episodeToken: current.episodeToken,
      action: stored,
      conditionState: 'firing',
      // 用同一个解析函数,保证 POST 报出来的状态就是随后 GET 会看到的状态。
      handlingState: resolveHandlingState(row, current.episodeToken, now),
      silencedUntil: row.silencedUntil ? row.silencedUntil.toISOString() : null,
      note: row.note,
      idempotent: false,
      at: row.updatedAt.toISOString(),
    }
  }
}

function parseNote(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') {
    throw new BadRequestException({
      error: { code: 'ALERT_NOTE_INVALID', message: 'note 必须是字符串' },
    })
  }
  const trimmed = raw.trim()
  if (trimmed.length > NOTE_MAX) {
    throw new BadRequestException({
      error: { code: 'ALERT_NOTE_TOO_LONG', message: `备注不能超过 ${NOTE_MAX} 字` },
    })
  }
  return trimmed.length > 0 ? trimmed : null
}

