/**
 * verify:branding 与 verify:license 共用的测试支撑：内存 Redis、Nest 应用装配、HTTP 调用、断言小工具。
 * PNG 夹具在 png-fixtures.ts。只给门禁用，不进生产代码。
 */
import 'reflect-metadata'
import { AddressInfo } from 'node:net'
import { BadRequestException, ValidationPipe, type INestApplication, type ValidationError } from '@nestjs/common'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'

// ── 内存 Redis：够 JwtAuthGuard 与 TerminalSessionService 用 ─────────────────

export class FakeRedis {
  readonly store = new Map<string, string>()
  /** 置 true 模拟 Redis 暂不可用：读写都抛错。 */
  down = false

  private check(): void {
    if (this.down) throw new Error('redis unavailable (fixture)')
  }

  async setJsonIfVersionNotOlder(): Promise<string> {
    return 'ok'
  }

  async get(key: string): Promise<string | null> {
    this.check()
    return this.store.get(key) ?? null
  }

  async setEx(key: string, _ttl: number, value: string): Promise<void> {
    this.check()
    this.store.set(key, value)
  }

  async getDel(key: string): Promise<string | null> {
    this.check()
    const value = this.store.get(key) ?? null
    this.store.delete(key)
    return value
  }

  async setIfAbsent(key: string, value: string): Promise<boolean> {
    this.check()
    if (this.store.has(key)) return false
    this.store.set(key, value)
    return true
  }

  async del(key: string): Promise<number> {
    this.check()
    return this.store.delete(key) ? 1 : 0
  }
}

// ── Nest 应用 + HTTP ────────────────────────────────────────────────────────

function flatten(errors: ValidationError[]): string[] {
  const out: string[] = []
  for (const error of errors) {
    if (error.constraints) out.push(...Object.values(error.constraints))
    if (error.children?.length) out.push(...flatten(error.children))
  }
  return out
}

/** 与 main.ts 同口径的全局管道与异常过滤器。 */
export function installGlobals(app: INestApplication): void {
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = flatten(errors)
        return new BadRequestException({
          error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details },
        })
      },
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())
}

export interface HttpResult {
  status: number
  headers: Headers
  json: { success?: boolean; data?: any; error?: { code?: string; message?: string; details?: any } }
  buffer: Buffer
}

export function makeCaller(app: INestApplication): (
  method: string,
  path: string,
  options?: { body?: unknown; token?: string; headers?: Record<string, string>; form?: FormData },
) => Promise<HttpResult> {
  const port = (app.getHttpServer().address() as AddressInfo).port
  const base = `http://127.0.0.1:${port}`
  return async (method, path, options = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.token) headers['authorization'] = `Bearer ${options.token}`
    let body: BodyInit | undefined
    if (options.form) body = options.form
    else if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    const response = await fetch(`${base}${path}`, { method, headers, body })
    const buffer = Buffer.from(await response.arrayBuffer())
    let json: HttpResult['json'] = {}
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      try {
        json = JSON.parse(buffer.toString('utf8'))
      } catch {
        json = {}
      }
    }
    return { status: response.status, headers: response.headers, json, buffer }
  }
}

// ── 断言小工具 ──────────────────────────────────────────────────────────────

export class Checker {
  failures = 0
  checks = 0

  check(name: string, ok: boolean, detail = ''): void {
    this.checks += 1
    if (ok) {
      console.log(`  PASS ${name}`)
      return
    }
    this.failures += 1
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }

  equal<T>(name: string, actual: T, expected: T): void {
    this.check(name, JSON.stringify(actual) === JSON.stringify(expected), `实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`)
  }

  finish(label: string): never {
    if (this.failures > 0) {
      console.error(`\n${label} FAIL：${this.failures}/${this.checks} 项未通过`)
      process.exit(1)
    }
    console.log(`\n${label} PASS：${this.checks} 项`)
    process.exit(0)
  }
}
