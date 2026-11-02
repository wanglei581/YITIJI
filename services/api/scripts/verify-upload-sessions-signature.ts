/**
 * 扫码上传会话放行 signature_image（触屏版走查 I-14）。
 *
 * 现象：后台把终端的「签名」开通后，第 2 步「手机扫码上传签名图」二维码必败 —— 一体机发
 * `POST /upload-sessions {purpose:'signature_image'}`，被 CreateUploadSessionDto 的 @IsIn 挡成 400。
 * 根因是两份白名单各写各的：service 的 SUPPORTED_UPLOAD_SESSION_PURPOSES / SIGNED_URL_PURPOSES
 * 早在 c096391fdf 就放行了 signature_image，唯独 DTO 漏了；service 级测试跑不到 DTO，所以一直没红。
 *
 * 本门禁钉四件事：
 *   A. DTO 与 service 放行同一份用途（对每个 FilePurpose 逐个比：DTO 收 ⇔ service 收），今后谁漏一边谁红；
 *   B. signature_image 会话只收图片：PNG / JPG 收，PDF / WebP / 伪装成图片的 PDF / 扩展名对不上的一律拒，
 *      拒了会话回到 pending 还能再传；超过 10MB 拒；
 *   C. 确认后回签短时内容链接（供签章合成读取），文件名缺省按图片起名而不是 resume.pdf；
 *   D. 会员绑定后仍是系统短期留存（1 小时），不会落成简历类 90 天默认。
 *
 * 不连库、不连 Redis（沿用 upload-session-verifier 的进程内替身；校验与魔数嗅探走真实代码）。
 * 真实 HTTP + 真实库 + 会员绑定的端到端在 verify-upload-sessions-http.ts。
 */
import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-upload-sessions-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { BadRequestException } from '@nestjs/common'
import { PURPOSE_POLICY } from '../src/files/file-validation'
import type { FilePurpose } from '../src/files/file.types'
import { defaultRetentionForUpload } from '../src/files/retention-policy'
import { verifyFileSignature } from '../src/files/signing'
import { CreateUploadSessionDto, UPLOAD_SESSION_PURPOSES } from '../src/upload-sessions/upload-sessions.dto'
import { expectRejects, file, makeService } from './support/upload-session-verifier'

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

const UPLOAD_URL = 'http://localhost:5173/upload/phone'
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('signature')])
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('signature')])
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const PDF_BYTES = Buffer.from('%PDF-1.4 not a signature')

async function dtoAccepts(purpose: string, mode = 'temporary'): Promise<boolean> {
  const dto = plainToInstance(CreateUploadSessionDto, { purpose, mode, channel: 'phone_h5' })
  const errors = await validate(dto)
  return errors.length === 0
}

async function serviceAccepts(purpose: FilePurpose): Promise<boolean> {
  const { service } = makeService()
  try {
    await service.create({ purpose, mode: 'temporary', channel: 'phone_h5', uploadUrl: UPLOAD_URL })
    return true
  } catch (error) {
    if (error instanceof BadRequestException) return false
    throw error
  }
}

async function main(): Promise<void> {
  console.log('A. DTO 与 service 放行同一份用途')
  assert.ok(await dtoAccepts('signature_image'), 'A1 DTO 必须收 signature_image（I-14：一体机签名第 2 步）')
  pass('A1 CreateUploadSessionDto 收 signature_image')
  assert.ok(await dtoAccepts('signature_image', 'member'), 'A2 会员模式同样收')
  pass('A2 会员模式的 signature_image 会话同样收')
  for (const bogus of ['id_scan', 'resume_scan', 'cover_letter', 'temp', 'admin_upload', 'screensaver_material', 'member_data_export', 'contract_review_report', 'self_assessment_report', 'nope', '']) {
    assert.equal(await dtoAccepts(bogus), false, `A3 DTO 不该收 ${JSON.stringify(bogus)}`)
  }
  pass('A3 DTO 仍拒绝清单外的用途（断言不是永远通过的假阳性）')
  const everyPurpose = Object.keys(PURPOSE_POLICY) as FilePurpose[]
  const mismatches: string[] = []
  for (const purpose of everyPurpose) {
    const dto = await dtoAccepts(purpose)
    const service = await serviceAccepts(purpose)
    if (dto !== service) mismatches.push(`${purpose}: DTO ${dto ? '收' : '拒'} / service ${service ? '收' : '拒'}`)
  }
  assert.deepEqual(mismatches, [], `A4 DTO 与 service 对每个用途必须结论一致：${mismatches.join('；')}`)
  pass(`A4 ${everyPurpose.length} 个 FilePurpose 逐个比对，DTO 与 service 结论一致`)
  const accepted = (await Promise.all(everyPurpose.map(async (purpose) => ((await dtoAccepts(purpose)) ? purpose : null)))).filter(Boolean)
  assert.deepEqual([...accepted].sort(), [...UPLOAD_SESSION_PURPOSES].sort(), 'A5 导出的清单就是 DTO 实际放行的清单')
  pass('A5 UPLOAD_SESSION_PURPOSES 与 DTO 实际放行的用途一致')

  console.log('B. signature_image 会话只收图片')
  {
    const { service, files } = makeService()
    const created = await service.create({ purpose: 'signature_image', mode: 'temporary', channel: 'phone_h5', uploadUrl: UPLOAD_URL })
    const upload = (f: Express.Multer.File) => service.uploadFile({ sessionId: created.sessionId, uploadToken: created.uploadToken, file: f })

    await expectRejects(() => upload(file({ originalname: '合同.pdf', mimetype: 'application/pdf', buffer: PDF_BYTES })), BadRequestException, 'B1 PDF')
    assert.equal((await service.getStatus(created.sessionId, created.controlToken)).status, 'pending', 'B1 被拒后会话回到 pending，可以重传')
    await expectRejects(() => upload(file({ originalname: 'sign.webp', mimetype: 'image/webp', buffer: WEBP_BYTES })), BadRequestException, 'B2 WebP')
    await expectRejects(() => upload(file({ originalname: 'sign.png', mimetype: 'image/png', buffer: PDF_BYTES })), BadRequestException, 'B3 伪装成 PNG 的 PDF')
    await expectRejects(() => upload(file({ originalname: 'sign.pdf', mimetype: 'image/png', buffer: PNG_BYTES })), BadRequestException, 'B4 扩展名与类型对不上')
    await expectRejects(
      () => upload(file({ originalname: 'big.png', mimetype: 'image/png', buffer: PNG_BYTES, size: 10 * 1024 * 1024 + 1 })),
      BadRequestException,
      'B5 超过 10MB',
    )
    pass('B1–B5 PDF、WebP、伪装图片、扩展名不符、超 10MB 一律拒收，且会话仍可重传')
    assert.equal(files.storedObjects.size, 0, 'B 被拒的文件一个字节都没落地')

    const ok = await upload(file({ originalname: '签名.png', mimetype: 'image/png', buffer: PNG_BYTES }))
    assert.equal(ok.status, 'uploaded')
    assert.equal(ok.purpose, 'signature_image')
    assert.equal(ok.file?.mimeType, 'image/png')
    assert.equal(ok.file?.filename, '签名.png')
    pass('B6 同一个会话被拒之后，PNG 可以接着传成功，回执用途是 signature_image')
  }
  {
    const { service } = makeService()
    const created = await service.create({ purpose: 'signature_image', mode: 'temporary', channel: 'phone_h5', uploadUrl: UPLOAD_URL })
    const ok = await service.uploadFile({
      sessionId: created.sessionId,
      uploadToken: created.uploadToken,
      file: file({ originalname: 'sign.jpg', mimetype: 'image/jpeg', buffer: JPEG_BYTES }),
    })
    assert.equal(ok.file?.mimeType, 'image/jpeg')
    pass('B7 JPG 同样收')
  }

  console.log('C. 确认回签短时内容链接，缺省文件名按图片起')
  {
    const { service, files } = makeService()
    const created = await service.create({ purpose: 'signature_image', mode: 'temporary', channel: 'phone_h5', uploadUrl: UPLOAD_URL })
    await service.uploadFile({
      sessionId: created.sessionId,
      uploadToken: created.uploadToken,
      file: file({ originalname: '', mimetype: 'image/png', buffer: PNG_BYTES }),
    })
    assert.equal(files.uploadCalls.at(-1)?.filename, 'signature.png', 'C1 手机没给文件名时缺省叫 signature.png，不能落成 resume.pdf')
    pass('C1 缺省文件名是 signature.png')
    const confirmed = await service.confirm(created.sessionId, created.controlToken)
    assert.equal(confirmed.status, 'confirmed')
    const url = new URL(confirmed.file.fileUrl ?? '', 'http://localhost')
    assert.equal(url.pathname, `/api/v1/files/${confirmed.file.fileId}/content`, 'C2 回签的是本系统内容地址')
    assert.ok(verifyFileSignature(confirmed.file.fileId, url.searchParams.get('expires') ?? '', url.searchParams.get('sig') ?? ''), 'C2 签名有效')
    pass('C2 确认后回签本系统短时内容链接（签章合成读取这份图片用）')
  }

  console.log('D. 留存：系统短期，不是简历类 90 天')
  {
    const decision = defaultRetentionForUpload({ purpose: 'signature_image', sensitiveLevel: 'highly_sensitive', ownerType: 'user', endUserId: 'eu_sign' })
    assert.equal(decision.retentionPolicy, 'system_short', 'D1 会员绑定后仍是系统短期')
    const hours = ((decision.expiresAt?.getTime() ?? 0) - Date.now()) / 3_600_000
    assert.ok(hours > 0.9 && hours < 1.1, `D1 高敏文件短期留存约 1 小时，实际 ${hours.toFixed(2)} 小时`)
    pass('D1 会员绑定后留存是系统短期 1 小时')
  }

  console.log('PASS verify-upload-sessions-signature')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
