import type { PrismaTransactionClient } from '../prisma/prisma.service'
import {
  PERSONAL_CHARGE_SETTING_KEY,
  TERMINAL_CHARGE_SERVICE_KEYS,
  type TerminalChargeServiceKey,
} from './terminal-charge.contract'

/** 复位前的收费设置。没设过价的键是 null，不写成 0。 */
export interface TerminalChargeResetSnapshot {
  userChargeMode: string
  personalChargeEnabled: boolean
  prices: Record<TerminalChargeServiceKey, number | null>
}

type SnapshotDb = Pick<PrismaTransactionClient, 'terminal' | 'platformSetting'>

/** 在改谁付钱、删价目之前读。只含收费方式、五个价和总开关，不含姓名或手机号。 */
export async function readTerminalChargeResetSnapshot(
  db: SnapshotDb,
  terminalId: string,
): Promise<TerminalChargeResetSnapshot> {
  const terminal = await db.terminal.findUniqueOrThrow({
    where: { id: terminalId },
    select: { userChargeMode: true, servicePrices: { select: { serviceKey: true, unitCents: true } } },
  })
  const setting = await db.platformSetting.findUnique({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    select: { value: true },
  })
  const prices = {} as Record<TerminalChargeServiceKey, number | null>
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
    const row = terminal.servicePrices.find((item) => item.serviceKey === key)
    prices[key] = row === undefined ? null : row.unitCents
  }
  return {
    userChargeMode: terminal.userChargeMode,
    personalChargeEnabled: setting?.value === 'true',
    prices,
  }
}
