/**
 * verify:branding 与 verify:license 共用的测试支撑：内存 Redis、Nest 应用装配、HTTP 调用、
 * 合成 PNG / WebP 夹具（含故意做坏的变体）。只给门禁用，不进生产代码。
 */
import 'reflect-metadata'
import { deflateSync } from 'node:zlib'
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

// ── PNG 夹具 ────────────────────────────────────────────────────────────────

let table: Uint32Array | null = null
export function crc32(buffer: Buffer): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

export function pngChunks(png: Buffer): Array<{ type: string; raw: Buffer; data: Buffer }> {
  const out: Array<{ type: string; raw: Buffer; data: Buffer }> = []
  let pos = 8
  while (pos < png.length) {
    const length = png.readUInt32BE(pos)
    const type = png.toString('latin1', pos + 4, pos + 8)
    out.push({ type, raw: png.subarray(pos, pos + 12 + length), data: png.subarray(pos + 8, pos + 8 + length) })
    pos += 12 + length
  }
  return out
}

/** 纯色 RGBA PNG。宽高任意（deflate 会把纯色压得很小，1024×1024 也只有几 KB）。 */
export function buildPng(width: number, height: number, extra: { afterIhdr?: Buffer[]; beforeIend?: Buffer[] } = {}): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const row = Buffer.alloc(1 + width * 4, 0)
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 4] = 0x00
    row[2 + x * 4] = 0x88
    row[3 + x * 4] = 0xcc
    row[4 + x * 4] = 0xff
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    ...(extra.afterIhdr ?? []),
    pngChunk('IDAT', deflateSync(raw)),
    ...(extra.beforeIend ?? []),
    pngChunk('IEND'),
  ])
}

// ── WebP 夹具 ───────────────────────────────────────────────────────────────

export interface WebpChunkFixture {
  type: string
  data: Buffer
}

export function parseWebp(webp: Buffer): WebpChunkFixture[] {
  const out: WebpChunkFixture[] = []
  let pos = 12
  while (pos < webp.length) {
    const type = webp.toString('latin1', pos, pos + 4)
    const size = webp.readUInt32LE(pos + 4)
    out.push({ type, data: webp.subarray(pos + 8, pos + 8 + size) })
    pos += 8 + size + (size & 1)
  }
  return out
}

export function buildWebp(chunks: WebpChunkFixture[]): Buffer {
  const parts: Buffer[] = []
  for (const chunk of chunks) {
    const head = Buffer.alloc(8)
    head.write(chunk.type, 0, 'latin1')
    head.writeUInt32LE(chunk.data.length, 4)
    parts.push(head, chunk.data)
    if (chunk.data.length & 1) parts.push(Buffer.from([0]))
  }
  const body = Buffer.concat(parts)
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'latin1')
  riff.writeUInt32LE(body.length + 4, 4)
  riff.write('WEBP', 8, 'latin1')
  return Buffer.concat([riff, body])
}

/** 用 @napi-rs/canvas 生成真实的 PNG / WebP（可解码）。 */
export function canvasImage(width: number, height: number, mime: 'image/png' | 'image/webp'): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const canvasModule = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
  const canvas = canvasModule.createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#0088cc'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#ffffff'
  context.fillRect(width / 4, height / 4, width / 2, height / 2)
  return canvas.toBuffer(mime)
}

/** 用 @napi-rs/canvas 解码，返回尺寸；解不出来抛错。 */
export async function decodeSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const canvasModule = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
  const image = await canvasModule.loadImage(buffer)
  return { width: image.width, height: image.height }
}

/** 把 VP8 / VP8L 图像块的尺寸写成给定值（造「画布尺寸与图像尺寸不一致」之类的变体用）。 */
export function vp8lChunk(width: number, height: number): WebpChunkFixture {
  const data = Buffer.alloc(5 + 4)
  data[0] = 0x2f
  data.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1)
  return { type: 'VP8L', data }
}

export function vp8xChunk(canvasWidth: number, canvasHeight: number, flags: number): WebpChunkFixture {
  const data = Buffer.alloc(10)
  data[0] = flags
  data.writeUIntLE(canvasWidth - 1, 4, 3)
  data.writeUIntLE(canvasHeight - 1, 7, 3)
  return { type: 'VP8X', data }
}
