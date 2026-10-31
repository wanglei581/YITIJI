/**
 * 扫描件回传的中文文件名不能乱码（触屏版走查 I-17）。
 *
 * 现象：模拟终端程序把「k1-扫描件.pdf」投回，结果屏、材料检查里显示成「scan-…-k1-æ«æä»¶.pdf」，库里
 * FileObject.filename 也是这串；同样的中文名走手机上传、U 盘、本机上传都没问题。
 *
 * 根因：multer（busboy）默认把 multipart 里的 filename 按 latin1 解码，而终端程序（form-data）和浏览器一样
 * 把文件名按 UTF-8 原样写进 Content-Disposition，中文就成了乱码。手机上传 / 本机上传的控制器早就用
 * restoreMultipartUtf8Filename 还原了，唯独 POST /terminals/:id/scan-sessions/deliver 直接用 file.originalname。
 *
 * 本门禁：
 *   1. 先用真实的 multipart（Node 自带 FormData → express + multer，与 Nest FileInterceptor 同一个解析器）
 *      验证「前提」：中文名确实被读成了 latin1 乱码（若哪天解析器配置改成直接给 UTF-8，这条只提示不红）；
 *   2. 再把 multer 实际给出的名字交给真实的 ScanTasksController.deliver，断言它交给 service 的文件名是原来的中文名；
 *   3. 纯 ASCII 名、合法的 Latin-1 名（café.pdf）原样放行，不被误改。
 *
 * 不连库、不连 Redis。
 */
import 'reflect-metadata'

import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import multer from 'multer'
import { ScanTasksController } from '../src/scan-tasks/scan-tasks.controller'

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

/** 用真实 multipart 把 `name` 发给 multer，回它解出来的 originalname。 */
async function originalnameAsMulterReadsIt(name: string): Promise<string> {
  const app = express()
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
  app.post('/deliver', upload.single('file'), (req, res) => {
    res.json({ originalname: req.file?.originalname ?? null })
  })
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    const { port } = server.address() as AddressInfo
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(Buffer.from('%PDF-1.4 scan'))], { type: 'application/pdf' }), name)
    const res = await fetch(`http://127.0.0.1:${port}/deliver`, { method: 'POST', body: form })
    const body = (await res.json()) as { originalname: string | null }
    assert.ok(body.originalname !== null, `multer 没解出文件：${name}`)
    return body.originalname
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function deliveredFilename(originalname: string): Promise<string> {
  const delivered: Array<{ filename: string }> = []
  const controller = new ScanTasksController(
    {
      deliverScanFile: async (args: { filename: string }) => {
        delivered.push(args)
        return { scanTaskId: 'st_1', fileId: 'f_1' }
      },
    } as never,
    { assertAgentAuthorized: async () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
  )
  await controller.deliver(
    'T-1',
    { originalname, buffer: Buffer.from('%PDF-1.4 scan'), mimetype: 'application/pdf' } as Express.Multer.File,
    'st_1',
    'lease',
    '2026-10-29T10:00:00.000Z',
    undefined,
    'Bearer agent-token',
  )
  assert.equal(delivered.length, 1, 'deliver 必须把文件交给 service')
  return delivered[0]!.filename
}

async function main(): Promise<void> {
  console.log('1. 前提：multer 对 UTF-8 文件名的解码')
  const chinese = ['k1-扫描件.pdf', '简历.pdf', '身份证 正面 (1).jpg', '2026-10-29 毕业证书扫描件.pdf']
  let misreadCount = 0
  const seen = new Map<string, string>()
  for (const name of chinese) {
    const read = await originalnameAsMulterReadsIt(name)
    seen.set(name, read)
    if (read !== name) misreadCount += 1
  }
  console.log(`  INFO multer 把 ${misreadCount}/${chinese.length} 个中文名读成了 latin1 乱码（例：${chinese[0]} → ${seen.get(chinese[0]!)}）`)

  console.log('2. 回传入口交给 service 的文件名必须是原来的中文名')
  for (const name of chinese) {
    const viaMulter = seen.get(name)!
    assert.equal(await deliveredFilename(viaMulter), name, `真实 multipart 读出「${viaMulter}」，交给 service 的必须是「${name}」`)
  }
  pass(`${chinese.length} 个中文名经真实 multipart 解码后，deliver 交给 service 的都是原名`)
  const mojibake = Buffer.from('k1-扫描件.pdf', 'utf8').toString('latin1')
  assert.notEqual(mojibake, 'k1-扫描件.pdf')
  assert.equal(await deliveredFilename(mojibake), 'k1-扫描件.pdf', '手工构造的 latin1 乱码同样还原')
  pass('latin1 乱码形态被还原为原来的中文名')

  console.log('3. 不该被改的名字原样放行')
  for (const name of ['scan_20261029_175614.pdf', 'Scan 001.jpg', 'café.pdf', 'Müller_Lebenslauf.pdf']) {
    assert.equal(await deliveredFilename(name), name, `${name} 不能被改写`)
  }
  pass('ASCII 名与合法的 Latin-1 名原样放行')

  console.log('PASS verify-scan-deliver-filename')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
