/**
 * verify:ad-asset-range —— 待机宣传屏素材必须真的支持 HTTP Range。
 *
 * 背景：`GET /ad-assets/:id/content` 一直在发 `Accept-Ranges: bytes`，但实现无视
 * Range 头，任何请求都回 200 + 全量。对 <video> 的后果是**拖不动进度条**——浏览器
 * 按这个头认为服务端支持 seek，实际拿不到区间。这是 CLAUDE.md §9「不伪造能力」
 * 的典型形态：宣称的能力必须真的有，否则就别发那个头。
 *
 * 本门禁钉两层：
 *   一、parseByteRange 的边界语义（三种写法 + 各类不可满足输入）
 *   二、controller 的响应行为：206 + Content-Range + 正确切片；不可满足回 416
 *       且带 `bytes *\/size`；无 Range 时仍是 200 全量；Accept-Ranges 一直在。
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

// 签名密钥只用于本门禁内部造一条合法链接；真实值绝不写进仓库。
process.env['FILE_SIGNING_SECRET'] ||= randomBytes(32).toString('hex')
import { HttpStatus } from '@nestjs/common'
import { ContentController, parseByteRange } from '../src/content/content.controller'
import { signAdAssetUrl } from '../src/content/content-signing'

function pass(msg: string): void {
  console.log(`  PASS ${msg}`)
}

/** 记录 controller 往 Response 上写了什么，不起真实 HTTP 服务。 */
function makeRes() {
  const headers: Record<string, string | number> = {}
  const state: { status: number; body: Buffer | null; ended: boolean } = {
    status: HttpStatus.OK,
    body: null,
    ended: false,
  }
  const chunks: Buffer[] = []
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk))
      cb()
    },
    final(cb) {
      if (!state.body && chunks.length) state.body = Buffer.concat(chunks)
      state.ended = true
      cb()
    },
  }) as Writable & {
    setHeader: (name: string, value: string | number) => void
    status: (code: number) => typeof writable
    send: (body: Buffer) => void
  }
  writable.setHeader = (name, value) => {
    headers[name.toLowerCase()] = value
  }
  writable.status = (code) => {
    state.status = code
    return writable
  }
  writable.send = (body) => {
    state.body = body
    state.ended = true
  }
  return { headers, state, res: writable }
}

async function main(): Promise<void> {
  // ── 一、parseByteRange 边界 ──────────────────────────────────────────────
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 }, '闭区间')
  assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 }, '开放右端收敛到末尾')
  assert.deepEqual(parseByteRange('bytes=-4', 10), { start: 6, end: 9 }, '后缀区间取最后 N 字节')
  assert.deepEqual(parseByteRange('bytes=-99', 10), { start: 0, end: 9 }, '后缀超长收敛为整个文件')
  assert.deepEqual(parseByteRange('bytes=2-99', 10), { start: 2, end: 9 }, '右端越界收敛到末尾')
  pass('parseByteRange 三种写法与越界收敛')

  assert.equal(parseByteRange('bytes=10-', 10), null, 'start 等于总长不可满足')
  assert.equal(parseByteRange('bytes=5-2', 10), null, 'end 小于 start 不可满足')
  assert.equal(parseByteRange('bytes=-', 10), null, '两端皆空不可满足')
  assert.equal(parseByteRange('items=0-1', 10), null, '非 bytes 单位不可满足')
  assert.equal(parseByteRange('bytes=2-5', 0), null, '空文件不可满足')
  assert.equal(parseByteRange(undefined, 10), null, '无 Range 头')
  // 多区间需要 multipart/byteranges 响应，我们不支持；必须判不可满足，
  // 不能悄悄只回第一段——那会让客户端拿到与请求不符的数据还以为成功。
  assert.equal(parseByteRange('bytes=1-2,4-5', 10), null, '多区间按不可满足处理')
  pass('parseByteRange 各类不可满足输入一律 null（含多区间不悄悄降级）')

  // ── 二、controller 响应行为 ─────────────────────────────────────────────
  const payload = Buffer.from('0123456789')
  const assetId = 'ad_asset_range_probe'
  const fakeContent = {
    describeAssetContent: async () => ({ mimeType: 'video/mp4', sizeBytes: payload.length }),
    readAssetRange: async (_id: string, start: number, end: number) => payload.subarray(start, end + 1),
    openAssetStream: async () => Readable.from(payload),
  }
  const controller = new ContentController(fakeContent as never)
  const signed = signAdAssetUrl(assetId)
  const url = new URL(signed.url, 'http://local')
  const expires = url.searchParams.get('expires') ?? ''
  const sig = url.searchParams.get('sig') ?? ''

  async function serve(rangeHeader?: string) {
    const captured = makeRes()
    await controller.serveAssetContent(
      assetId,
      expires,
      sig,
      { headers: rangeHeader ? { range: rangeHeader } : {} } as never,
      captured.res as never,
    )
    return captured
  }

  const whole = await serve()
  assert.equal(whole.state.status, HttpStatus.OK)
  assert.equal(whole.headers['accept-ranges'], 'bytes')
  assert.equal(whole.headers['content-length'], payload.length)
  assert.equal(whole.state.body?.toString(), '0123456789')
  pass('无 Range 头：200 + 全量，且 Accept-Ranges 仍在')

  const partial = await serve('bytes=2-5')
  assert.equal(partial.state.status, HttpStatus.PARTIAL_CONTENT, '必须 206 而不是 200')
  assert.equal(partial.headers['content-range'], 'bytes 2-5/10')
  assert.equal(partial.headers['content-length'], 4)
  assert.equal(partial.state.body?.toString(), '2345', '切片内容必须与请求区间一致')
  pass('bytes=2-5 → 206 + Content-Range + 正确切片（进度条能拖动的前提）')

  const suffix = await serve('bytes=-3')
  assert.equal(suffix.state.status, HttpStatus.PARTIAL_CONTENT)
  assert.equal(suffix.headers['content-range'], 'bytes 7-9/10')
  assert.equal(suffix.state.body?.toString(), '789')
  pass('bytes=-3 → 取最后 3 字节')

  const unsat = await serve('bytes=99-')
  assert.equal(unsat.state.status, HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE, '不可满足必须 416')
  assert.equal(unsat.headers['content-range'], 'bytes */10', '416 必须回带真实总长')
  assert.equal(unsat.state.body, null, '416 不得回内容体')
  pass('不可满足区间 → 416 + bytes */size，不假装成功回全量')

  const controllerSrc = readFileSync(path.resolve(__dirname, '../src/content/content.controller.ts'), 'utf8')
  const serveStart = controllerSrc.indexOf('async serveAssetContent')
  const serveFn = controllerSrc.slice(serveStart, controllerSrc.indexOf('\n}', serveStart) + 2)
  assert.doesNotMatch(serveFn, /readAssetContent\(/, 'Range 路径不得再整段 getObject/readAssetContent')
  assert.match(serveFn, /readAssetRange\(/, 'Range 必须走 readAssetRange/getObjectRange')
  assert.match(serveFn, /openAssetStream\(/, '无 Range 必须流式 pipe')
  const serviceSrc = readFileSync(path.resolve(__dirname, '../src/content/content.service.ts'), 'utf8')
  assert.match(serviceSrc, /getObjectRange\(/, 'storage 必须提供 getObjectRange')
  assert.match(serviceSrc, /listPlaylists\([\s\S]*take/, 'listPlaylists 必须带 take/分页')
  pass('源码：Range 不整段入内存，listPlaylists 有 take')

  console.log('\n✅ verify:ad-asset-range 全部通过')
}

main().catch((e: unknown) => {
  console.error('\n❌ verify:ad-asset-range 失败:', (e as Error).message)
  console.error((e as Error).stack)
  process.exit(1)
})
