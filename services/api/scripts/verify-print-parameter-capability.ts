import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PrintJobParamsDto } from '../src/print-jobs/dto/create-print-job.dto'
import { assertVerifiedPrintParameters } from '../src/print-jobs/verified-print-parameters'

const apiRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(apiRoot, '../..')

function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), 'utf8')
}

function pass(message: string): void { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

function errorCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return (response as { error?: { code?: string } } | undefined)?.error?.code
}

async function expectDtoRejected(patch: Partial<PrintJobParamsDto>, label: string): Promise<void> {
  const dto = plainToInstance(PrintJobParamsDto, {
    copies: 1,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
    ...patch,
  })
  const errors = await validate(dto)
  if (errors.length > 0) pass(label)
  else fail(`${label}：DTO 未拒绝`)
}

async function expectDtoAccepted(patch: Partial<PrintJobParamsDto>, label: string): Promise<void> {
  const dto = plainToInstance(PrintJobParamsDto, {
    copies: 1,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
    ...patch,
  })
  const errors = await validate(dto)
  if (errors.length === 0) pass(label)
  else fail(`${label}：DTO 错误拒绝`)
}

function expectServiceRejected(patch: Partial<PrintJobParamsDto>, label: string): void {
  try {
    assertVerifiedPrintParameters({
      colorMode: 'black_white',
      duplex: 'simplex',
      pagesPerSheet: 1,
      ...patch,
    })
  } catch (error) {
    if (errorCode(error) === 'PRINT_PARAMETER_NOT_VERIFIED') {
      pass(label)
      return
    }
    fail(`${label}：错误码不正确`)
  }
  fail(`${label}：service 门禁未拒绝`)
}

async function main(): Promise<void> {
  console.log('\n=== 打印参数已验证能力 fail-closed 合同（第 1 层：全局产品边界）===')
  // 彩色 / 双面的按终端判定属**第 2 层**，由 verify:print-color-duplex-capability 覆盖。
  // 本脚本只守第 1 层：N-up 恒拒、枚举合法性、以及「门禁在计价之前」的顺序。

  const safeDto = plainToInstance(PrintJobParamsDto, {
    copies: 1,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
  })
  if ((await validate(safeDto)).length === 0) pass('DTO 接受当前已验证安全组合：黑白/单面/1页每张')
  else fail('DTO 错误拒绝当前安全组合')

  // 彩色 / 双面取值在 DTO 放开（2026-08-18 产品拍板）；能不能用由第 2 层按终端判定。
  await expectDtoAccepted({ colorMode: 'color' }, 'DTO 接受彩色取值（准入交第 2 层）')
  await expectDtoAccepted({ duplex: 'duplex_long_edge' }, 'DTO 接受长边双面取值')
  await expectDtoAccepted({ duplex: 'duplex_short_edge' }, 'DTO 接受短边双面取值')
  await expectDtoRejected({ pagesPerSheet: 2 }, 'DTO 拒绝每张2页')
  await expectDtoRejected({ pagesPerSheet: 4 }, 'DTO 拒绝每张4页')
  await expectDtoRejected({ colorMode: 'rainbow' }, 'DTO 拒绝枚举外 colorMode')
  await expectDtoRejected({ duplex: 'both_sides' }, 'DTO 拒绝枚举外 duplex')

  assertVerifiedPrintParameters({ colorMode: 'black_white', duplex: 'simplex', pagesPerSheet: 1 })
  pass('第 1 层接受基线组合')
  assertVerifiedPrintParameters({ colorMode: 'color', duplex: 'duplex_long_edge', pagesPerSheet: 1 })
  pass('第 1 层放行彩色 + 双面（全局边界已开放，按终端判定见第 2 层门禁）')
  expectServiceRejected({ pagesPerSheet: 2 }, '第 1 层拒绝 N-up 绕过 DTO')
  expectServiceRejected({ colorMode: 'rainbow' }, '第 1 层拒绝枚举外 colorMode 绕过 DTO')

  const printJobs = read(apiRoot, 'src/print-jobs/print-jobs.service.ts')
  const quote = read(apiRoot, 'src/payment/order-quote.service.ts')
  const shared = read(repoRoot, 'packages/shared/src/types/print.ts')
  const printGuardIndex = printJobs.indexOf('assertVerifiedPrintParameters(')
  const printQuoteIndex = printJobs.indexOf('this.pricing.quotePrint(')
  if (printGuardIndex >= 0 && printQuoteIndex > printGuardIndex) pass('建单在报价和落库前执行参数能力门禁')
  else fail('建单缺少报价/落库前参数能力门禁')
  const quoteGuardIndex = quote.indexOf('assertVerifiedPrintParameters(')
  const quotePriceIndex = quote.indexOf('this.pricing.quotePrint(')
  if (quoteGuardIndex >= 0 && quotePriceIndex > quoteGuardIndex) pass('公开报价在计价前执行参数能力门禁')
  else fail('公开报价缺少计价前参数能力门禁')
  if (
    shared.includes('VERIFIED_PRINT_PARAMETER_PROFILE') &&
    shared.includes("colorMode: 'black_white'") &&
    shared.includes("duplex: 'simplex'") &&
    shared.includes('pagesPerSheet: 1')
  ) pass('shared 保留 wire union，并声明最保守安全 profile（能力未知时用它）')
  else fail('shared 缺少最保守安全 profile')

  if (
    shared.includes('restrictToAllowedPrintParams') &&
    shared.includes('hasParamsBeyondCapability')
  ) pass('shared 提供按终端能力收口 helper（不再无条件砍成黑白）')
  else fail('shared 缺少按终端能力收口 helper')

  console.log('\nALL PASS')
}

void main()
