/**
 * 共用库门禁用的收费夹具。不放在 src：生产代码不该带测试复位。
 *
 * 第一次改某台终端或总开关之前记下原样。finally 里调用 restore，
 * 把总开关和这些终端的谁付钱、五个价写回去。终端已经被删掉就跳过这一行，开关仍要复位。
 * 复位失败必须抛出，不能吞掉。
 */
import type { PrismaService } from '../../src/prisma/prisma.service'
import { PRINT_UNIT_PRICE_CENTS } from '../../src/print-jobs/print-pricing'
import {
  PERSONAL_CHARGE_SETTING_KEY,
  type TerminalChargeServiceKey,
} from '../../src/payment/terminal-charge.contract'

interface TerminalSnapshot {
  userChargeMode: string
  prices: Array<{ serviceKey: string; unitCents: number }>
}

interface FixtureState {
  priorSwitch: string | null
  terminals: Map<string, TerminalSnapshot>
}

const states = new WeakMap<object, FixtureState>()

async function stateFor(db: PrismaService): Promise<FixtureState> {
  const existing = states.get(db)
  if (existing) return existing
  const row = await db.platformSetting.findUnique({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
  const created: FixtureState = {
    priorSwitch: row?.value ?? null,
    terminals: new Map(),
  }
  states.set(db, created)
  return created
}

async function rememberTerminal(db: PrismaService, terminalId: string): Promise<void> {
  const state = await stateFor(db)
  if (state.terminals.has(terminalId)) return
  const terminal = await db.terminal.findUnique({
    where: { id: terminalId },
    select: {
      userChargeMode: true,
      servicePrices: { select: { serviceKey: true, unitCents: true } },
    },
  })
  state.terminals.set(terminalId, {
    userChargeMode: terminal?.userChargeMode ?? 'org_pays',
    prices: (terminal?.servicePrices ?? []).map((price) => ({
      serviceKey: price.serviceKey,
      unitCents: price.unitCents,
    })),
  })
}

/** 把一台已存在的终端配成向用户收费，并打开总开关。不经过公共点位 409。 */
export async function setTerminalUserPrintPrices(
  db: PrismaService,
  terminalId: string,
  prices: Partial<Record<TerminalChargeServiceKey, number>>,
): Promise<void> {
  await rememberTerminal(db, terminalId)
  await db.platformSetting.upsert({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
    update: { value: 'true' },
  })
  await db.terminal.update({ where: { id: terminalId }, data: { userChargeMode: 'user_pays' } })
  for (const [serviceKey, unitCents] of Object.entries(prices) as Array<[TerminalChargeServiceKey, number]>) {
    await db.terminalServicePrice.upsert({
      where: { terminalId_serviceKey: { terminalId, serviceKey } },
      create: { terminalId, serviceKey, unitCents },
      update: { unitCents },
    })
  }
}

/** 把开发种子价写到这台机器上，并打开总开关。用户实付只认本机生效价。 */
export async function adoptDevPrintSeedPrices(db: PrismaService, terminalId: string): Promise<void> {
  await setTerminalUserPrintPrices(db, terminalId, {
    print_bw_page: PRINT_UNIT_PRICE_CENTS.black_white,
    print_color_page: PRINT_UNIT_PRICE_CENTS.color,
  })
}

/** 把本客户端改过的总开关和终端收费设置写回第一次改之前。 */
export async function restoreTerminalChargeFixture(db: PrismaService): Promise<void> {
  const state = states.get(db)
  if (!state) return
  for (const [terminalId, snapshot] of state.terminals) {
    const existing = await db.terminal.findUnique({ where: { id: terminalId }, select: { id: true } })
    if (!existing) continue
    await db.terminal.update({
      where: { id: terminalId },
      data: { userChargeMode: snapshot.userChargeMode },
    })
    await db.terminalServicePrice.deleteMany({ where: { terminalId } })
    for (const price of snapshot.prices) {
      await db.terminalServicePrice.create({
        data: { terminalId, serviceKey: price.serviceKey, unitCents: price.unitCents },
      })
    }
  }
  if (state.priorSwitch == null) {
    await db.platformSetting.deleteMany({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
  } else {
    await db.platformSetting.upsert({
      where: { key: PERSONAL_CHARGE_SETTING_KEY },
      create: { key: PERSONAL_CHARGE_SETTING_KEY, value: state.priorSwitch },
      update: { value: state.priorSwitch },
    })
  }
}
