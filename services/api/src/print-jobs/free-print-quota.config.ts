import { AuditService } from '../audit/audit.service'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import {
  AUDIT_PRINT_FREE_QUOTA_UPDATE,
  FREE_PRINT_ALERT_PERCENT,
  FREE_PRINT_GUEST_PER_ORDER_SIDES,
  FREE_PRINT_MEMBER_DAILY_SIDES,
  FREE_PRINT_QUOTA_KEYS,
  FREE_PRINT_TERMINAL_DAILY_SIDES,
  KEY_ALERT_PERCENT,
  KEY_GUEST_PER_ORDER_SIDES,
  KEY_MEMBER_DAILY_SIDES,
  KEY_TERMINAL_DAILY_SIDES,
  assertAlertPercent,
  assertQuotaSides,
  parseAlertPercent,
  parseQuotaSides,
  type FreePrintQuotaConfig,
} from './free-print-quota.policy'

type SettingStore = PrismaService | PrismaTransactionClient

function defaultFreePrintQuotaConfig(): FreePrintQuotaConfig {
  return {
    terminalDailySides: FREE_PRINT_TERMINAL_DAILY_SIDES,
    memberDailySides: FREE_PRINT_MEMBER_DAILY_SIDES,
    guestPerOrderSides: FREE_PRINT_GUEST_PER_ORDER_SIDES,
    alertPercent: FREE_PRINT_ALERT_PERCENT,
  }
}

export async function readFreePrintQuotaConfig(db: SettingStore): Promise<FreePrintQuotaConfig> {
  // 告警门禁的内存桩没有 platformSetting。缺这一列就用默认值，不把桩当成配置故障。
  if (typeof db.platformSetting?.findMany !== 'function') return defaultFreePrintQuotaConfig()
  const rows = await db.platformSetting.findMany({
    where: { key: { in: [...FREE_PRINT_QUOTA_KEYS] } },
    select: { key: true, value: true },
  })
  const map = new Map(rows.map((row) => [row.key, row.value]))
  return {
    terminalDailySides: parseQuotaSides(map.get(KEY_TERMINAL_DAILY_SIDES), FREE_PRINT_TERMINAL_DAILY_SIDES),
    memberDailySides: parseQuotaSides(map.get(KEY_MEMBER_DAILY_SIDES), FREE_PRINT_MEMBER_DAILY_SIDES),
    guestPerOrderSides: parseQuotaSides(map.get(KEY_GUEST_PER_ORDER_SIDES), FREE_PRINT_GUEST_PER_ORDER_SIDES),
    alertPercent: parseAlertPercent(map.get(KEY_ALERT_PERCENT)),
  }
}

async function writeKey(
  tx: PrismaTransactionClient,
  key: string,
  value: string,
  updatedBy: string,
): Promise<void> {
  await tx.platformSetting.upsert({
    where: { key },
    create: { key, value, updatedBy },
    update: { value, updatedBy },
  })
}

export async function updateFreePrintQuotaConfig(
  prisma: PrismaService,
  audit: AuditService,
  next: FreePrintQuotaConfig,
  actor: { userId: string; role: string },
): Promise<FreePrintQuotaConfig> {
  assertQuotaSides(next.terminalDailySides, '每台每天免费打印上限')
  assertQuotaSides(next.memberDailySides, '每人每天免费打印上限')
  assertQuotaSides(next.guestPerOrderSides, '免登录每单上限')
  assertAlertPercent(next.alertPercent)
  return prisma.$transaction(async (tx) => {
    const before = await readFreePrintQuotaConfig(tx)
    await writeKey(tx, KEY_TERMINAL_DAILY_SIDES, String(next.terminalDailySides), actor.userId)
    await writeKey(tx, KEY_MEMBER_DAILY_SIDES, String(next.memberDailySides), actor.userId)
    await writeKey(tx, KEY_GUEST_PER_ORDER_SIDES, String(next.guestPerOrderSides), actor.userId)
    await writeKey(tx, KEY_ALERT_PERCENT, String(next.alertPercent), actor.userId)
    const after = await readFreePrintQuotaConfig(tx)
    await audit.writeRequired(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_PRINT_FREE_QUOTA_UPDATE,
      targetType: 'system',
      targetId: 'print-free-quota',
      payload: { before, after },
    })
    return after
  })
}
