import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { EndKioskSessionDto, StartKioskSessionDto, TouchKioskSessionDto } from './dto/kiosk-session.dto'
import {
  KIOSK_SERVICE_CATEGORIES,
  KIOSK_SESSION_CLOCK_SKEW_MS,
  KIOSK_SESSION_IDLE_EXPIRY_MS,
  KIOSK_SESSION_NOT_FOUND_CODE,
  type KioskServiceCategory,
} from './kiosk-session.types'

export interface KioskSessionAck {
  recorded: boolean
}

/**
 * 一体机报来的时间只在 [earliest, now] 内采信，否则用服务器时间（时钟漂移、回填都挡在这里）。
 * 晚于服务器时间的一律按 now 记。
 */
export function clampReportedTime(reported: string, now: Date, earliest: Date): Date {
  const at = new Date(reported)
  if (Number.isNaN(at.getTime())) return now
  if (at.getTime() > now.getTime() || at.getTime() < earliest.getTime()) return now
  return at
}

function parseCategories(json: string): KioskServiceCategory[] {
  try {
    const value: unknown = JSON.parse(json)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is KioskServiceCategory =>
      typeof item === 'string' && (KIOSK_SERVICE_CATEGORIES as readonly string[]).includes(item))
  } catch {
    return []
  }
}

function withCategory(json: string, category: KioskServiceCategory | undefined): string {
  const current = parseCategories(json)
  if (!category || current.includes(category)) return JSON.stringify(current)
  return JSON.stringify([...current, category])
}

/**
 * 服务人次写入。terminalId 一律来自 TerminalIdentityGuard 验过的请求头，
 * 机构取写入时终端的所属机构作快照。不写 memberId。
 */
@Injectable()
export class KioskSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async start(terminalId: string, dto: StartKioskSessionDto, now = new Date()): Promise<KioskSessionAck> {
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId }, select: { orgId: true } })
    // 清场之后开始的周期可能空等很久才有人来，相差超过 10 分钟就按服务器时间记开始。
    const startedAt = clampReportedTime(dto.wokeAt, now, new Date(now.getTime() - KIOSK_SESSION_CLOCK_SKEW_MS))
    // 同一终端同一周期的重放只落一条；重放不改已记下的任何字段。
    await this.prisma.kioskSession.upsert({
      where: { terminalId_clientSessionId: { terminalId, clientSessionId: dto.clientSessionId } },
      create: {
        terminalId,
        orgId: terminal?.orgId ?? null,
        clientSessionId: dto.clientSessionId,
        startedAt,
        lastActiveAt: now,
        expiresAt: new Date(now.getTime() + KIOSK_SESSION_IDLE_EXPIRY_MS),
        categoriesJson: JSON.stringify([dto.category]),
      },
      update: {},
    })
    return { recorded: true }
  }

  async touch(terminalId: string, dto: TouchKioskSessionDto, now = new Date()): Promise<KioskSessionAck> {
    const row = await this.find(terminalId, dto.clientSessionId)
    // 已结束的会话不再续期，也不再追加大类。
    if (row.endedAt) return { recorded: false }
    await this.prisma.kioskSession.update({
      where: { id: row.id },
      data: {
        lastActiveAt: now,
        expiresAt: new Date(now.getTime() + KIOSK_SESSION_IDLE_EXPIRY_MS),
        categoriesJson: withCategory(row.categoriesJson, dto.category),
      },
    })
    return { recorded: true }
  }

  async end(terminalId: string, dto: EndKioskSessionDto, now = new Date()): Promise<KioskSessionAck> {
    const row = await this.find(terminalId, dto.clientSessionId)
    if (row.endedAt) return { recorded: false }
    const endedAt = clampReportedTime(dto.endedAt, now, row.startedAt)
    await this.prisma.kioskSession.update({
      where: { id: row.id },
      data: { endedAt, endReason: dto.endReason, isExpired: true, lastActiveAt: endedAt > row.lastActiveAt ? endedAt : row.lastActiveAt },
    })
    return { recorded: true }
  }

  private async find(terminalId: string, clientSessionId: string) {
    const row = await this.prisma.kioskSession.findUnique({
      where: { terminalId_clientSessionId: { terminalId, clientSessionId } },
      select: { id: true, startedAt: true, lastActiveAt: true, endedAt: true, categoriesJson: true },
    })
    if (!row) {
      throw new NotFoundException({ error: { code: KIOSK_SESSION_NOT_FOUND_CODE, message: '没有这次使用记录' } })
    }
    return row
  }
}
