/**
 * HttpExceptionFilter error-shape regression checks.
 *
 * Run: pnpm --filter @ai-job-print/api verify:http-exception-filter
 */
import { ArgumentsHost, BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function assert(condition: boolean, message: string): void {
  if (!condition) fail(message)
  pass(message)
}

function capture(exception: unknown): { statusCode: number; body: any } {
  const filter = new HttpExceptionFilter()
  const captured: { statusCode?: number; body?: any } = {}
  const response = {
    status(statusCode: number) {
      captured.statusCode = statusCode
      return this
    },
    json(body: unknown) {
      captured.body = body
      return this
    },
  }
  const host = {
    switchToHttp() {
      return {
        getResponse: () => response,
        getRequest: () => ({ requestId: 'verify-http-exception-filter' }),
      }
    },
  } as unknown as ArgumentsHost

  filter.catch(exception, host)
  return { statusCode: captured.statusCode ?? 0, body: captured.body }
}

function main(): void {
  console.log('\n=== HttpExceptionFilter error-shape regression checks ===')

  const structured = capture(new BadRequestException({
    error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败', details: ['fileUrl should not be empty'] },
  }))
  assert(structured.statusCode === 400, 'structured BadRequest keeps HTTP 400')
  assert(structured.body.error.code === 'VALIDATION_FAILED', 'structured error keeps code')
  assert(structured.body.error.message === '请求参数校验失败', 'structured error keeps message')
  assert(Array.isArray(structured.body.error.details) && structured.body.error.details[0] === 'fileUrl should not be empty', 'structured error keeps details')

  const shorthand = capture(new BadRequestException('PRICE_CONFIG_UNAVAILABLE'))
  assert(shorthand.statusCode === 400, 'shorthand BadRequest keeps HTTP 400')
  assert(shorthand.body.error.code === 'PRICE_CONFIG_UNAVAILABLE', 'shorthand BadRequest maps message code to error.code')
  assert(shorthand.body.error.message === 'PRICE_CONFIG_UNAVAILABLE', 'shorthand BadRequest maps message code to error.message')
  assert(shorthand.body.requestId === 'verify-http-exception-filter', 'error response includes requestId')

  const rawMachineCode = capture(new HttpException('PRINT_PAGE_COUNT_UNAVAILABLE', HttpStatus.BAD_REQUEST))
  assert(rawMachineCode.statusCode === 400, 'raw string machine-code HttpException keeps HTTP 400')
  assert(rawMachineCode.body.error.code === 'PRINT_PAGE_COUNT_UNAVAILABLE', 'raw string machine-code HttpException maps to error.code')
  assert(rawMachineCode.body.error.message === 'PRINT_PAGE_COUNT_UNAVAILABLE', 'raw string machine-code HttpException maps to error.message')

  const notFoundMachineCode = capture(new NotFoundException('ORDER_NOT_FOUND'))
  assert(notFoundMachineCode.statusCode === 404, 'shorthand NotFound keeps HTTP 404')
  assert(notFoundMachineCode.body.error.code === 'ORDER_NOT_FOUND', 'shorthand NotFound maps message code to error.code')
  assert(notFoundMachineCode.body.error.message === 'ORDER_NOT_FOUND', 'shorthand NotFound maps message code to error.message')

  const humanReadable = capture(new BadRequestException('Invalid input'))
  assert(humanReadable.statusCode === 400, 'human-readable BadRequest keeps HTTP 400')
  assert(humanReadable.body.error.code === 'Bad Request', 'human-readable BadRequest keeps generic error code')
  assert(humanReadable.body.error.message === '服务器内部错误', 'human-readable BadRequest does not expose raw message')

  const rawHumanReadable = capture(new HttpException('redis://user:secret@example.internal:6379 failed', HttpStatus.BAD_REQUEST))
  assert(rawHumanReadable.statusCode === 400, 'raw human-readable HttpException keeps HTTP 400')
  assert(rawHumanReadable.body.error.code === 'INTERNAL_SERVER_ERROR', 'raw human-readable HttpException keeps generic default code')
  assert(rawHumanReadable.body.error.message === '服务器内部错误', 'raw human-readable HttpException does not expose raw message')

  const unstructuredMachineCode = capture(new HttpException({ message: 'PRINT_PAGE_COUNT_UNAVAILABLE' }, HttpStatus.INTERNAL_SERVER_ERROR))
  assert(unstructuredMachineCode.statusCode === 500, 'unstructured machine-code internal error keeps HTTP 500')
  assert(unstructuredMachineCode.body.error.code === 'PRINT_PAGE_COUNT_UNAVAILABLE', 'unstructured machine-code internal error maps to error.code')
  assert(unstructuredMachineCode.body.error.message === 'PRINT_PAGE_COUNT_UNAVAILABLE', 'unstructured machine-code internal error maps to error.message')

  const unstructuredInternal = capture(new HttpException({ message: 'redis://user:secret@example.internal:6379 failed' }, HttpStatus.INTERNAL_SERVER_ERROR))
  assert(unstructuredInternal.statusCode === 500, 'unstructured internal error keeps HTTP 500')
  assert(unstructuredInternal.body.error.code === 'INTERNAL_SERVER_ERROR', 'unstructured internal error keeps generic error code')
  assert(unstructuredInternal.body.error.message === '服务器内部错误', 'unstructured internal error does not expose raw message')

  console.log('\nALL PASS')
}

main()
