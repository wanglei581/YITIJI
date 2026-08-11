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
  console.log('\n=== 打印参数已验证能力 fail-closed 合同 ===')

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

  await expectDtoRejected({ colorMode: 'color' }, 'DTO 拒绝彩色')
  await expectDtoRejected({ duplex: 'duplex_long_edge' }, 'DTO 拒绝长边双面')
  await expectDtoRejected({ duplex: 'duplex_short_edge' }, 'DTO 拒绝短边双面')
  await expectDtoRejected({ pagesPerSheet: 2 }, 'DTO 拒绝每张2页')
  await expectDtoRejected({ pagesPerSheet: 4 }, 'DTO 拒绝每张4页')

  assertVerifiedPrintParameters({ colorMode: 'black_white', duplex: 'simplex', pagesPerSheet: 1 })
  pass('service 门禁接受当前安全组合')
  expectServiceRejected({ colorMode: 'color' }, 'service 门禁拒绝彩色绕过 DTO')
  expectServiceRejected({ duplex: 'duplex_long_edge' }, 'service 门禁拒绝双面绕过 DTO')
  expectServiceRejected({ pagesPerSheet: 2 }, 'service 门禁拒绝 N-up 绕过 DTO')

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
  ) pass('shared 保留 wire union，并声明当前已验证安全 profile')
  else fail('shared 缺少当前已验证安全 profile')

  console.log('\nALL PASS')
}

void main()
