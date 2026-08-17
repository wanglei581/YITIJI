/**
 * 彩色 / 双面开放门禁（2026-08-18 产品负责人拍板开放后新增）。
 *
 * 背景：硬件（奔图 CM2800/CM2820）确实支持彩色与自动双面，但**驱动映射从未在真机上验证过**。
 * 直接放开 DTO 的后果是资损级的：用户按彩色付费、拿到黑白纸。
 * 因此开放采用「开阀门 + 按终端实际能力校验」：
 *   第 1 层 assertVerifiedPrintParameters()          —— 全局产品边界（N-up 恒拒）
 *   第 2 层 TerminalCapabilitiesService.assertPrintParamsAllowed() —— 按终端 fail-closed
 *
 * 本门禁断言：
 *   A. 契约三副本一致（shared / api / admin 各有一份能力键 union）。
 *   B. DTO 放开彩色/双面取值，但 N-up 仍被拒。
 *   C. 第 1 层放行彩色/双面、拒绝 N-up。
 *   D. **未登记能力的终端拒绝彩色/双面，且错误码可辨识**；managed 模式也拒（不受 env 影响）。
 *   E. **登记为 available 后放行**；非 available 状态仍拒。
 *   F. **彩色订单按彩色价目计价**（不是黑白）。
 *   G. **双面不改变金额**（按内容页计价，见下方说明）——防止有人「顺手」加双面附加费而超收。
 *   H. 静态断言：两条计价路径都在 quotePrint **之前**执行了第 2 层门禁。
 *
 * 关于 G：仓库里并不存在 print_duplex_surcharge 价目行，它只出现在 payment.ts 的注释举例中。
 * price-config.seed 明确写了「本批按内容页计价，duplex / pagesPerSheet 不影响单价」。
 * 双面省的是纸不是内容页，维持同价是既有且自洽的定价策略；本门禁把它钉死，
 * 避免未来无意中引入双面加价（那是反向资损）。要改成加价必须是显式的产品决策 + 改本断言。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:print-color-duplex-capability
 */
import 'dotenv/config'
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import path from 'path'
import { PrismaService } from '../src/prisma/prisma.service'
import { PrintJobParamsDto } from '../src/print-jobs/dto/create-print-job.dto'
import { assertVerifiedPrintParameters } from '../src/print-jobs/verified-print-parameters'
import {
  TerminalCapabilitiesService,
  setPrintScanCapabilityModeForTest,
} from '../src/terminals/terminal-capabilities.service'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PRINT_UNIT_PRICE_CENTS } from '../src/print-jobs/print-pricing'
import * as apiContract from '../src/terminals/terminal-capabilities.types'
import * as sharedContract from '../../../packages/shared/src/types/printScanCapability'

const apiRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(apiRoot, '../..')

function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), 'utf8')
}

function pass(m: string): void {
  console.log(`  PASS ${m}`)
}
function fail(m: string): never {
  console.error(`  FAIL ${m}`)
  process.exit(1)
}

function errorCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return (response as { error?: { code?: string } } | undefined)?.error?.code
}

function errorMessage(error: unknown): string {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return (response as { error?: { message?: string } } | undefined)?.error?.message ?? ''
}

const BASE_DTO = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  orientation: 'auto',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
}

async function dtoAccepts(patch: Record<string, unknown>, label: string): Promise<void> {
  const errors = await validate(plainToInstance(PrintJobParamsDto, { ...BASE_DTO, ...patch }))
  if (errors.length === 0) pass(label)
  else fail(`${label}：DTO 错误拒绝（${JSON.stringify(errors.map((e) => e.property))}）`)
}

async function dtoRejects(patch: Record<string, unknown>, label: string): Promise<void> {
  const errors = await validate(plainToInstance(PrintJobParamsDto, { ...BASE_DTO, ...patch }))
  if (errors.length > 0) pass(label)
  else fail(`${label}：DTO 未拒绝`)
}

/** 期望第 2 层门禁抛出指定错误码。 */
async function expectCapabilityDenied(
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const code = errorCode(error)
    if (code !== expectedCode) {
      fail(`${label}：错误码应为 ${expectedCode}，实际 ${String(code)}`)
    }
    // 拒绝理由必须诚实：说「本机未验证」，不能说「不支持」（硬件是支持的）。
    const message = errorMessage(error)
    if (message.includes('不支持')) {
      fail(`${label}：拒绝理由把「未验证」说成「不支持」，属谎报硬件能力 —— ${message}`)
    }
    if (!message.includes('验证')) {
      fail(`${label}：拒绝理由未说明是「尚未通过真机验证」 —— ${message}`)
    }
    pass(`${label}（${expectedCode}）`)
    return
  }
  fail(`${label}：门禁未拒绝（fail-closed 失效）`)
}

async function main(): Promise<void> {
  console.log('\n=== 彩色 / 双面按终端能力开放门禁 ===')

  // ── A. 契约三副本一致 ──────────────────────────────────────────────────────
  console.log('\n-- A. 能力键契约副本一致性 --')
  if (
    JSON.stringify(apiContract.PRINT_SCAN_CAPABILITY_KEYS) ===
    JSON.stringify(sharedContract.PRINT_SCAN_CAPABILITY_KEYS)
  ) {
    pass('shared 与 api 能力键副本一致')
  } else {
    fail('shared 与 api 能力键副本漂移')
  }
  if (
    JSON.stringify(apiContract.DEFAULT_DENY_CAPABILITY_KEYS) ===
    JSON.stringify(sharedContract.DEFAULT_DENY_CAPABILITY_KEYS)
  ) {
    pass('shared 与 api 的 fail-closed 键副本一致')
  } else {
    fail('shared 与 api 的 fail-closed 键副本漂移')
  }
  for (const key of ['color_print', 'duplex_print']) {
    if (!(apiContract.PRINT_SCAN_CAPABILITY_KEYS as readonly string[]).includes(key)) {
      fail(`能力键缺少 ${key}`)
    }
    if (!(apiContract.DEFAULT_DENY_CAPABILITY_KEYS as readonly string[]).includes(key)) {
      fail(`${key} 必须是 fail-closed 键（未配置 = 拒绝）`)
    }
  }
  pass('color_print / duplex_print 均已登记且为 fail-closed 键')

  // Admin 前端第三副本（容易被漏改：另外两份的文件头只提到彼此）
  const adminCopy = read(repoRoot, 'apps/admin/src/services/api/printScan.ts')
  if (adminCopy.includes("'color_print'") && adminCopy.includes("'duplex_print'")) {
    pass('Admin 前端能力键第三副本已同步')
  } else {
    fail('Admin 前端 printScan.ts 能力键副本未同步（管理员将无法配置彩色/双面）')
  }
  const adminPage = read(repoRoot, 'apps/admin/src/routes/print-scan/index.tsx')
  if (adminPage.includes('color_print:') && adminPage.includes('duplex_print:')) {
    pass('Admin 能力配置页提供彩色/双面标签（管理员可显式放行）')
  } else {
    fail('Admin 能力配置页缺少彩色/双面标签，放行路径不存在')
  }

  // ── B / C. DTO 与第 1 层门禁 ───────────────────────────────────────────────
  console.log('\n-- B/C. DTO 与全局产品边界 --')
  await dtoAccepts({}, 'DTO 接受基线：黑白 / 单面 / 每张 1 页')
  await dtoAccepts({ colorMode: 'color' }, 'DTO 接受彩色取值（准入交给第 2 层）')
  await dtoAccepts({ duplex: 'duplex_long_edge' }, 'DTO 接受长边双面取值')
  await dtoAccepts({ duplex: 'duplex_short_edge' }, 'DTO 接受短边双面取值')
  await dtoRejects({ pagesPerSheet: 2 }, 'DTO 仍拒绝 N-up（每张 2 页）')
  await dtoRejects({ pagesPerSheet: 4 }, 'DTO 仍拒绝 N-up（每张 4 页）')
  await dtoRejects({ colorMode: 'rainbow' }, 'DTO 拒绝枚举外 colorMode')

  assertVerifiedPrintParameters({ colorMode: 'color', duplex: 'duplex_long_edge', pagesPerSheet: 1 })
  pass('第 1 层放行彩色 + 双面（全局产品边界已开放）')
  try {
    assertVerifiedPrintParameters({ colorMode: 'black_white', duplex: 'simplex', pagesPerSheet: 2 })
    fail('第 1 层未拒绝 N-up')
  } catch (error) {
    if (errorCode(error) === 'PRINT_PARAMETER_NOT_VERIFIED') pass('第 1 层仍拒绝 N-up')
    else fail(`第 1 层拒绝 N-up 的错误码不正确：${String(errorCode(error))}`)
  }

  // ── D/E/F/G. DB 侧：按终端 fail-closed + 计价 ─────────────────────────────
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const pricing = new PricingService(prisma)

  const suffix = randomUUID().slice(0, 8)
  const terminalId = randomUUID()

  try {
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `VCD-${suffix}`,
        agentToken: `tok_vcd_${suffix}`,
        deviceFingerprint: 'fp',
      },
    })

    console.log('\n-- D. 未登记能力的终端：fail-closed --')
    // managed 是默认模式，也是「未配置行放行」的那个模式 —— 这两个键必须**不**受它影响。
    setPrintScanCapabilityModeForTest('managed')

    await expectCapabilityDenied(
      () => capabilities.assertPrintParamsAllowed(terminalId, { colorMode: 'color', duplex: 'simplex' }),
      'PRINT_COLOR_NOT_VERIFIED_ON_TERMINAL',
      'managed 模式下未登记终端仍拒绝彩色',
    )
    await expectCapabilityDenied(
      () =>
        capabilities.assertPrintParamsAllowed(terminalId, {
          colorMode: 'black_white',
          duplex: 'duplex_long_edge',
        }),
      'PRINT_DUPLEX_NOT_VERIFIED_ON_TERMINAL',
      'managed 模式下未登记终端仍拒绝双面',
    )
    await capabilities.assertPrintParamsAllowed(terminalId, {
      colorMode: 'black_white',
      duplex: 'simplex',
    })
    pass('基线组合（黑白 / 单面）无需能力登记即可放行')

    console.log('\n-- E. 管理员显式登记后放行 --')
    await capabilities.upsert(terminalId, 'color_print', 'available', '真机验过彩色出纸', 'verify')
    await capabilities.assertPrintParamsAllowed(terminalId, { colorMode: 'color', duplex: 'simplex' })
    pass('color_print 配为 available 后彩色放行')

    // 双面仍未登记 → 组合请求仍应被拒（逐项判定，不因彩色已放行而整体放过）
    await expectCapabilityDenied(
      () =>
        capabilities.assertPrintParamsAllowed(terminalId, {
          colorMode: 'color',
          duplex: 'duplex_short_edge',
        }),
      'PRINT_DUPLEX_NOT_VERIFIED_ON_TERMINAL',
      '彩色已放行但双面未登记时，组合请求仍被拒',
    )

    await capabilities.upsert(terminalId, 'duplex_print', 'available', null, 'verify')
    await capabilities.assertPrintParamsAllowed(terminalId, {
      colorMode: 'color',
      duplex: 'duplex_long_edge',
    })
    pass('两项均登记为 available 后彩色 + 双面放行')

    // 非 available 状态必须重新拒绝（含 DB 脏值归 not_verified）
    for (const status of ['testing', 'maintenance', 'unsupported', 'not_verified']) {
      await capabilities.upsert(terminalId, 'color_print', status, null, 'verify')
      await expectCapabilityDenied(
        () => capabilities.assertPrintParamsAllowed(terminalId, { colorMode: 'color' }),
        'PRINT_COLOR_NOT_VERIFIED_ON_TERMINAL',
        `color_print=${status} 时彩色被拒`,
      )
    }
    await capabilities.upsert(terminalId, 'color_print', 'available', null, 'verify')

    console.log('\n-- F/G. 计价：彩色按彩色价，双面不改价 --')
    await seedDevDefaultPriceConfig(prisma)

    const bwQuote = await pricing.quotePrint({
      billablePages: 4,
      billingPageSource: 'pdf_lightweight_scan',
      copies: 1,
      colorMode: 'black_white',
    })
    const colorQuote = await pricing.quotePrint({
      billablePages: 4,
      billingPageSource: 'pdf_lightweight_scan',
      copies: 1,
      colorMode: 'color',
    })

    const expectedBw = PRINT_UNIT_PRICE_CENTS.black_white * 4
    const expectedColor = PRINT_UNIT_PRICE_CENTS.color * 4
    if (bwQuote.amountCents !== expectedBw) {
      fail(`黑白计价错误：期望 ${expectedBw}，实际 ${bwQuote.amountCents}`)
    }
    if (colorQuote.amountCents !== expectedColor) {
      fail(`彩色计价错误：期望 ${expectedColor}，实际 ${colorQuote.amountCents}`)
    }
    if (colorQuote.amountCents === bwQuote.amountCents) {
      fail('彩色与黑白金额相同 —— 彩色订单被按黑白计价（反向资损）')
    }
    pass(`彩色按彩色价目计价：${colorQuote.amountCents} 分 ≠ 黑白 ${bwQuote.amountCents} 分`)

    if (colorQuote.lines[0]?.serviceKey !== 'print_color_page') {
      fail(`彩色报价的价目项应为 print_color_page，实际 ${String(colorQuote.lines[0]?.serviceKey)}`)
    }
    if (bwQuote.lines[0]?.serviceKey !== 'print_bw_page') {
      fail(`黑白报价的价目项应为 print_bw_page，实际 ${String(bwQuote.lines[0]?.serviceKey)}`)
    }
    pass('报价行 serviceKey 与 colorMode 一致（print_color_page / print_bw_page）')

    // G：双面不进计价入参 —— 结构上就不可能因 duplex 改价。
    const pricingSrc = read(apiRoot, 'src/payment/pricing.service.ts')
    const inputBlock = pricingSrc.slice(
      pricingSrc.indexOf('export interface PrintPriceInput'),
      pricingSrc.indexOf('}', pricingSrc.indexOf('export interface PrintPriceInput')),
    )
    if (inputBlock.includes('duplex')) {
      fail('PrintPriceInput 出现 duplex —— 双面加价属未经决策的定价变更，会造成超收')
    }
    pass('双面不参与计价入参：按内容页计价，双面与单面同价（省的是纸不是内容页）')

    const seedSrc = read(apiRoot, 'src/payment/price-config.seed.ts')
    if (seedSrc.includes('print_duplex_surcharge')) {
      fail('price-config.seed 引入了 print_duplex_surcharge 价目行，与「双面不改价」策略冲突')
    }
    pass('无 print_duplex_surcharge 价目行（该键仅存在于注释举例，不是真实价目）')
  } finally {
    setPrintScanCapabilityModeForTest(null)
    await prisma.terminalCapability.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.onModuleDestroy()
  }

  // ── H. 静态：两条计价路径都先过第 2 层 ────────────────────────────────────
  console.log('\n-- H. 计价路径必须先过按终端门禁 --')
  const printJobs = read(apiRoot, 'src/print-jobs/print-jobs.service.ts')
  const guardIdx = printJobs.indexOf('assertPrintParamsAllowed(')
  const quoteIdx = printJobs.indexOf('this.pricing.quotePrint(')
  if (guardIdx >= 0 && quoteIdx > guardIdx) {
    pass('建单路径在 quotePrint 之前执行按终端能力门禁')
  } else {
    fail('建单路径缺少 quotePrint 之前的按终端能力门禁 —— 会按彩色计价后才发现本机没验过')
  }

  const orderQuote = read(apiRoot, 'src/payment/order-quote.service.ts')
  const oqGuardIdx = orderQuote.indexOf('assertTerminalAllowsParams(')
  const oqQuoteIdx = orderQuote.indexOf('this.pricing.quotePrint(')
  if (oqGuardIdx >= 0 && oqQuoteIdx > oqGuardIdx) {
    pass('公开报价路径在 quotePrint 之前执行按终端能力门禁')
  } else {
    fail('公开报价路径缺少 quotePrint 之前的按终端能力门禁')
  }
  if (!orderQuote.includes('PRINT_TERMINAL_REQUIRED_FOR_PARAMS')) {
    fail('公开报价缺少「彩色/双面必须带 terminalId」的 fail-closed 分支')
  }
  pass('公开报价对缺失 terminalId 的彩色/双面请求 fail-closed')

  const memberCreate = read(apiRoot, 'src/member-print-orders/member-print-order-create.service.ts')
  if (memberCreate.includes('terminalId: terminal.id')) {
    pass('小程序建单把 terminalId 传入报价（能力判定不落空）')
  } else {
    fail('小程序建单未传 terminalId，彩色/双面将绕过按终端能力判定')
  }

  // Kiosk 侧不得再谎报「当前仅开放黑白」，也不得用原生 disabled 遮蔽原因
  // PrintParamsPage 已于 #690 下线（与预览页重复且零运行时导航），参数入口只剩预览页。
  const preview = read(repoRoot, 'apps/kiosk/src/pages/print/PrintPreviewPage.tsx')
  for (const [name, src] of [['PrintPreviewPage', preview]]) {
    if (!src.includes('usePrintParamCapability')) {
      fail(`${name} 未按终端能力决定彩色/双面可用性`)
    }
    if (src.includes('当前仅开放黑白、单面、每张 1 页')) {
      fail(`${name} 仍写死「当前仅开放黑白」，在已验证终端上属谎报`)
    }
    if (!src.includes('aria-disabled')) {
      fail(`${name} 禁用态未使用可聚焦的 aria-disabled`)
    }
  }
  pass('Kiosk 参数页按终端能力启用/禁用，且禁用态可聚焦可解释')

  // ── I. Playwright 夹具桩必须贴合服务端真实返回形状 ──────────────────────────
  // 背景：#697 查出全仓 118 处 mock 有 95 处无比对机制，且发生过「mock 伪造了服务端
  // 根本不返回的字段 → 用例长期全绿、真实后端 100% 失败」。彩色/双面闸门的浏览器覆盖
  // 依赖 GET /terminals/:id/capabilities 的桩，这里把桩与真实契约钉在一起。
  //
  // 真实形状取证：terminals.controller.ts 的匿名端点直接 return listForTerminal()，
  // **不包 ApiResponse**，故 wire 形状就是 { terminalCode, capabilities: TerminalCapabilityView[] }。
  console.log('\n-- I. 浏览器夹具桩 vs 服务端真实契约 --')
  const w2Spec = read(repoRoot, 'apps/kiosk/tests/visual/fusion-w2-print.spec.ts')

  const publicController = read(apiRoot, 'src/terminals/terminals.controller.ts')
  const anonHandler = publicController.slice(publicController.indexOf("@Get('terminals/:terminalId/capabilities')"))
  if (/return this\.capabilities\.listForTerminal\(/.test(anonHandler.slice(0, 400))) {
    pass('匿名能力端点直接返回 listForTerminal（桩不该包 ApiResponse 外层）')
  } else {
    fail('匿名能力端点返回形状已变，Playwright 桩可能与真实 wire 形状漂移')
  }

  const stubBlock = w2Spec.slice(
    w2Spec.indexOf('const UNVERIFIED_CAPABILITIES'),
    w2Spec.indexOf('function registerShell'),
  )
  if (stubBlock.length === 0) fail('w2 夹具缺少 UNVERIFIED_CAPABILITIES 桩')

  // 桩必须覆盖真实契约的**全部**能力键：契约加键而桩没跟上时这里就红。
  // 只取数组字面量部分（`].map(` 之前），避免把 map 体里的 status 字面量算进来。
  const keyArray = stubBlock.slice(0, stubBlock.indexOf('].map('))
  const stubKeys = [...keyArray.matchAll(/'([a-z_]+)',/g)].map((m) => m[1])
  const contractKeys = [...apiContract.PRINT_SCAN_CAPABILITY_KEYS]
  if (JSON.stringify([...stubKeys].sort()) === JSON.stringify([...contractKeys].sort())) {
    pass(`w2 夹具桩覆盖真实契约全部 ${contractKeys.length} 个能力键`)
  } else {
    fail(
      `w2 夹具桩与真实能力键不一致：桩 ${stubKeys.length} 个 / 契约 ${contractKeys.length} 个；` +
        `缺 ${contractKeys.filter((k) => !stubKeys.includes(k)).join(',') || '无'}；` +
        `多 ${stubKeys.filter((k) => !(contractKeys as string[]).includes(k)).join(',') || '无'}`,
    )
  }

  // 桩里出现的每个 status 都必须是真实枚举值，不能自造。
  // 范围严格限定在能力桩：UNVERIFIED_CAPABILITIES 块内的 status，
  // 加上 capabilitiesWith({ color_print: 'x', duplex_print: 'y' }) 的覆盖值。
  // （不扫全文件——那会把订单/支付状态误当能力状态。）
  const stubStatuses = [
    ...[...stubBlock.matchAll(/status:\s*'([a-z_]+)'/g)].map((m) => m[1]),
    ...[...w2Spec.matchAll(/(?:color_print|duplex_print):\s*'([a-z_]+)'/g)].map((m) => m[1]),
  ]
  const realStatuses = apiContract.PRINT_SCAN_CAPABILITY_STATUSES as readonly string[]
  const bogus = [...new Set(stubStatuses)].filter((v) => !realStatuses.includes(v))
  if (bogus.length === 0) pass(`w2 夹具桩只使用真实状态枚举（${[...new Set(stubStatuses)].join('/')}）`)
  else fail(`w2 夹具桩出现枚举外状态：${bogus.join(',')}`)

  // 桩行的字段集必须等于 TerminalCapabilityView，不多不少（多 = 伪造服务端不返回的字段）。
  const viewFields = ['capabilityKey', 'status', 'note', 'configured', 'updatedAt'].sort()
  // 只看 .map() 产出的对象字面量：字段既可能是简写（capabilityKey,）也可能是 key: value。
  const rowLiteral = stubBlock.slice(stubBlock.indexOf('].map('))
  const stubFields = [...new Set([...rowLiteral.matchAll(/^\s{2}([a-zA-Z]+)[,:]/gm)].map((m) => m[1]))].sort()
  if (JSON.stringify(stubFields) === JSON.stringify(viewFields)) {
    pass('w2 夹具桩字段集恰为 TerminalCapabilityView，无伪造字段')
  } else {
    fail(`w2 夹具桩字段集与 TerminalCapabilityView 不符：桩 [${stubFields.join(',')}] vs 真实 [${viewFields.join(',')}]`)
  }

  // 闸门两端都要被浏览器验过：只桩一种情形等于半边没测。
  if (
    w2Spec.includes('unverified terminal disables color and duplex with an honest reason') &&
    w2Spec.includes('terminal verified for color and duplex can actually select them')
  ) {
    pass('浏览器用例覆盖闸门两端：未登记拒绝 + 登记 available 放行')
  } else {
    fail('浏览器用例未同时覆盖「未登记拒绝」与「登记后放行」两种情形')
  }

  const home = read(repoRoot, 'apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx')
  if (home.includes("description: 'PDF、图片上传后设参数打印，A4 黑白 / 彩色、双面可选'")) {
    fail('打印域首屏仍静态声称「彩色、双面可选」，未验证的机器上属谎报')
  }
  if (!home.includes('describeDocPrint')) {
    fail('打印域首屏未按能力动态表述彩色/双面')
  }
  pass('打印域首屏文案按本机能力动态表述')

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
