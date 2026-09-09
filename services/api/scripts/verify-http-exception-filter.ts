/**
 * HttpExceptionFilter error-shape regression checks.
 *
 * Run: pnpm --filter @ai-job-print/api verify:http-exception-filter
 */
import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
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
  // 这两条断言此前写成「message === 服务器内部错误」。名字说的是「不暴露原始文案」，
  // 断言却钉死了一句**说错了故障方向**的兜底句 —— 400 自称服务端崩了。
  // 现在按名字的真实意图拆成两条：① 不泄露原文；② 兜底句符合状态码的性质。
  assert(!humanReadable.body.error.message.includes('Invalid input'), 'human-readable BadRequest does not expose raw message')
  assert(humanReadable.body.error.message === '请求内容有误，请检查后重试', 'human-readable BadRequest falls back to a 4xx-shaped message')

  const rawHumanReadable = capture(new HttpException('redis://user:secret@example.internal:6379 failed', HttpStatus.BAD_REQUEST))
  assert(rawHumanReadable.statusCode === 400, 'raw human-readable HttpException keeps HTTP 400')
  // 这条断言此前钉的是 `code === 'INTERNAL_SERVER_ERROR'` —— **把缺陷写成了期望值**：
  // 一个 HTTP 400 的机器码说「服务端内部错误」，调用方按 code 分支会当成服务端崩了
  // 去重试或报障，而真相是「你的请求有问题」。2026-09-09 生产实测同形态：
  //   POST /api/v1/payment/sandbox/simulate
  //   → HTTP 404 {"error":{"code":"INTERNAL_SERVER_ERROR","message":"请求的内容不存在"}}
  // message 早在 #975 修对了，code 一直没跟上；而本门禁把没跟上的那一半钉住了。
  assert(rawHumanReadable.body.error.code === 'BAD_REQUEST', 'raw human-readable HttpException falls back to a 4xx-shaped code')
  assert(rawHumanReadable.body.error.code !== 'INTERNAL_SERVER_ERROR', 'a 400 must not carry an internal-server-error code')
  // 泄露防线是这条用例存在的理由：原文里带连接串、内网域名和口令。
  // 逐个词查，而不是只比一句固定文案 —— 后者在兜底句变化时会悄悄失去判别力。
  for (const secret of ['redis://', 'user:secret', 'example.internal', '6379']) {
    assert(
      !rawHumanReadable.body.error.message.includes(secret),
      `raw human-readable HttpException does not leak "${secret}"`,
    )
  }
  assert(rawHumanReadable.body.error.message === '请求内容有误，请检查后重试', 'raw human-readable HttpException falls back to a 4xx-shaped message')

  // ── 4xx 兜底句必须说对故障方向（2026-09-08 生产实测：未匹配路由自称服务端崩了）──
  // 路由不存在时 Nest 抛的就是这个形状：{message:'Cannot GET /x', error:'Not Found', statusCode:404}。
  const unmatchedRoute = capture(
    new HttpException({ message: 'Cannot GET /api/v1/nope', error: 'Not Found', statusCode: 404 }, HttpStatus.NOT_FOUND),
  )
  assert(unmatchedRoute.statusCode === 404, 'unmatched route keeps HTTP 404')
  assert(unmatchedRoute.body.error.message === '请求的内容不存在', 'unmatched route says the content is missing, not that the server failed')
  assert(!unmatchedRoute.body.error.message.includes('Cannot GET'), 'unmatched route does not echo the raw path')
  assert(unmatchedRoute.body.error.message !== '服务器内部错误', 'a 404 must not claim an internal server error')

  // 裸抛（响应体里没有 error.code）时，机器码同样必须跟上状态码。
  // 这正是 2026-09-09 生产实测那一发的形状：`throw new NotFoundException()`。
  const bareNotFound = capture(new HttpException({}, HttpStatus.NOT_FOUND))
  assert(bareNotFound.statusCode === 404, 'bare NotFound keeps HTTP 404')
  assert(bareNotFound.body.error.code === 'NOT_FOUND', 'bare NotFound carries a 404-shaped machine code')
  assert(bareNotFound.body.error.message === '请求的内容不存在', 'bare NotFound says the content is missing')

  for (const [status, expected] of [
    [HttpStatus.UNAUTHORIZED, '身份校验未通过，请重新登录后再试'],
    [HttpStatus.FORBIDDEN, '没有权限执行该操作'],
    [HttpStatus.METHOD_NOT_ALLOWED, '该操作方式不被支持'],
    [HttpStatus.CONFLICT, '操作发生冲突，请刷新后重试'],
  ] as Array<[number, string]>) {
    const got = capture(new HttpException('some internal detail', status))
    assert(got.statusCode === status, `${status} keeps its status`)
    assert(got.body.error.message === expected, `${status} falls back to a status-appropriate message`)
    assert(!got.body.error.message.includes('some internal detail'), `${status} does not expose raw message`)
    // 机器码和给人看的那句必须同时说对方向；只修一半就是今天这个 bug 的来源。
    assert(
      got.body.error.code !== 'INTERNAL_SERVER_ERROR',
      `${status} must not carry an internal-server-error machine code`,
    )
  }

  // 反向：5xx 仍然必须说「服务器内部错误」。否则这次改动就把真故障也说糊了。
  const stillServerFault = capture(new HttpException('boom', HttpStatus.BAD_GATEWAY))
  assert(stillServerFault.statusCode === 502, '5xx keeps its status')
  assert(stillServerFault.body.error.message === '服务器内部错误', '5xx still reports a server-side fault')

  const unstructuredMachineCode = capture(new HttpException({ message: 'PRINT_PAGE_COUNT_UNAVAILABLE' }, HttpStatus.INTERNAL_SERVER_ERROR))
  assert(unstructuredMachineCode.statusCode === 500, 'unstructured machine-code internal error keeps HTTP 500')
  assert(unstructuredMachineCode.body.error.code === 'PRINT_PAGE_COUNT_UNAVAILABLE', 'unstructured machine-code internal error maps to error.code')
  assert(unstructuredMachineCode.body.error.message === 'PRINT_PAGE_COUNT_UNAVAILABLE', 'unstructured machine-code internal error maps to error.message')

  const unstructuredInternal = capture(new HttpException({ message: 'redis://user:secret@example.internal:6379 failed' }, HttpStatus.INTERNAL_SERVER_ERROR))
  assert(unstructuredInternal.statusCode === 500, 'unstructured internal error keeps HTTP 500')
  assert(unstructuredInternal.body.error.code === 'INTERNAL_SERVER_ERROR', 'unstructured internal error keeps generic error code')
  assert(unstructuredInternal.body.error.message === '服务器内部错误', 'unstructured internal error does not expose raw message')

  const throttled = capture(new ThrottlerException())
  assert(throttled.statusCode === 429, 'ThrottlerException keeps HTTP 429')
  assert(throttled.body.error.code === 'RATE_LIMITED', 'ThrottlerException maps to RATE_LIMITED (not INTERNAL_SERVER_ERROR)')
  assert(throttled.body.error.message === '尝试过于频繁，请稍后再试', 'ThrottlerException shows friendly rate-limit message')

  const oversized = capture(new PayloadTooLargeException('File too large'))
  assert(oversized.statusCode === 413, 'oversized upload keeps HTTP 413')
  assert(oversized.body.error.code === 'FILE_TOO_LARGE', 'oversized upload maps to stable FILE_TOO_LARGE code')
  assert(oversized.body.error.message === '上传文件过大，请缩小后重试', 'oversized upload shows a useful message')

  console.log('\nALL PASS')
}

main()
