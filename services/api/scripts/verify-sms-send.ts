/**
 * TencentSmsSender.sendCode() 发送链路验证（本地 stub，不连真实腾讯云）。
 *
 * 起一个本地 http server 冒充 sms.tencentcloudapi.com，校验:
 * - 请求:POST、TC3-HMAC-SHA256 Authorization、X-TC-Action/Version/Region、E.164 手机号、
 *   SignName/TemplateId/SmsSdkAppId、单/双参数 TemplateParamSet。
 * - 响应:Code=Ok → 成功;Response.Error 或状态非 Ok → 抛 SMS_SEND_FAILED 并保留 providerCode。
 * 真号 E2E 仍需短信审核通过 + 真实密钥 + 真实手机号，另行验收。
 */
import 'dotenv/config'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createSmsSender, TencentSmsSender } from '../src/member-auth/sms/sms-sender'

let pass = 0
let fail = 0
const ok = (m: string) => { console.log(`  ✅ ${m}`); pass++ }
const bad = (m: string) => { console.error(`  ❌ ${m}`); fail++ }
const providerCodeOf = (e: unknown): string | undefined => {
  const code = (e as { providerCode?: unknown } | undefined)?.providerCode
  return typeof code === 'string' ? code : undefined
}

let nextResponse: unknown = { Response: { SendStatusSet: [{ Code: 'Ok' }], RequestId: 'req' } }
let last: { method?: string; headers: http.IncomingHttpHeaders; body: string } = { headers: {}, body: '' }

const server = http.createServer((req, res) => {
  let chunks = ''
  req.on('data', (d) => (chunks += d))
  req.on('end', () => {
    last = { method: req.method, headers: req.headers, body: chunks }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(nextResponse))
  })
})

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as AddressInfo).port

  process.env['SMS_PROVIDER'] = 'tencent'
  process.env['TENCENT_SMS_SECRET_ID'] = 'placeholder-id'
  process.env['TENCENT_SMS_SECRET_KEY'] = 'placeholder-key'
  process.env['TENCENT_SMS_SDK_APP_ID'] = '1400000000'
  process.env['TENCENT_SMS_SIGN_NAME'] = 'AI求职打印服务终端'
  process.env['TENCENT_SMS_TEMPLATE_ID'] = '123456'
  process.env['TENCENT_SMS_REGION'] = 'ap-guangzhou'
  process.env['TENCENT_SMS_HOST'] = `127.0.0.1:${port}`
  delete process.env['TENCENT_SMS_CODE_EXPIRE_MINUTES']

  console.log('\n=== TencentSmsSender.sendCode 发送链路验证（本地 stub）===')

  const sender = createSmsSender()
  if (sender instanceof TencentSmsSender) ok('createSmsSender 返回 TencentSmsSender')
  else { bad('createSmsSender 未返回 TencentSmsSender'); return finish() }

  // 1) Ok 响应 → 成功 + 请求字段断言
  nextResponse = { Response: { SendStatusSet: [{ Code: 'Ok', Message: 'send success' }], RequestId: 'req-ok' } }
  try { await sender.sendCode('13800000000', '123456'); ok('Code=Ok → sendCode 成功') }
  catch (e) { bad(`Ok 响应不应抛错: ${(e as Error).message}`) }

  const body = JSON.parse(last.body) as Record<string, unknown>
  last.method === 'POST' ? ok('请求方法 POST') : bad(`方法非 POST: ${last.method}`)
  String(last.headers['authorization'] ?? '').startsWith('TC3-HMAC-SHA256')
    ? ok('Authorization 为 TC3-HMAC-SHA256 签名') : bad('缺 TC3 Authorization 头')
  last.headers['x-tc-action'] === 'SendSms' ? ok('X-TC-Action=SendSms') : bad(`X-TC-Action 错: ${last.headers['x-tc-action']}`)
  last.headers['x-tc-version'] === '2021-01-11' ? ok('X-TC-Version=2021-01-11') : bad(`X-TC-Version 错: ${last.headers['x-tc-version']}`)
  last.headers['x-tc-region'] === 'ap-guangzhou' ? ok('X-TC-Region 透传') : bad(`X-TC-Region 错: ${last.headers['x-tc-region']}`)
  JSON.stringify(body['PhoneNumberSet']) === '["+8613800000000"]'
    ? ok('手机号 E.164 (+86) 转换正确') : bad(`PhoneNumberSet 错: ${JSON.stringify(body['PhoneNumberSet'])}`)
  body['SignName'] === 'AI求职打印服务终端' && body['TemplateId'] === '123456' && body['SmsSdkAppId'] === '1400000000'
    ? ok('SignName/TemplateId/SmsSdkAppId 正确') : bad('模板/签名字段错误')
  JSON.stringify(body['TemplateParamSet']) === '["123456"]'
    ? ok('单参数模板 TemplateParamSet=[code]') : bad(`TemplateParamSet 错: ${JSON.stringify(body['TemplateParamSet'])}`)

  // 2) 已带 + 的号码原样
  nextResponse = { Response: { SendStatusSet: [{ Code: 'Ok' }], RequestId: 'r2' } }
  await sender.sendCode('+8613900000000', '000000').catch(() => undefined)
  ;(JSON.parse(last.body) as { PhoneNumberSet: string[] }).PhoneNumberSet[0] === '+8613900000000'
    ? ok('已带 + 的号码原样不再加 +86') : bad('E.164 原样失败')

  // 3) 双参数模板（env 配有效期分钟）
  process.env['TENCENT_SMS_CODE_EXPIRE_MINUTES'] = '5'
  await sender.sendCode('13800000000', '654321').catch(() => undefined)
  JSON.stringify((JSON.parse(last.body) as { TemplateParamSet: string[] }).TemplateParamSet) === '["654321","5"]'
    ? ok('双参数模板 TemplateParamSet=[code, minutes]') : bad(`双参数失败: ${last.body}`)
  delete process.env['TENCENT_SMS_CODE_EXPIRE_MINUTES']

  // 4) Response.Error → 抛 SMS_SEND_FAILED
  nextResponse = { Response: { Error: { Code: 'LimitExceeded.PhoneNumberDailyLimit', Message: 'x' }, RequestId: 'r4' } }
  try { await sender.sendCode('13800000000', '111111'); bad('API Error 应抛错') }
  catch (e) {
    (e as Error).message === 'SMS_SEND_FAILED' ? ok('Response.Error → 抛 SMS_SEND_FAILED') : bad(`错误信息不符: ${(e as Error).message}`)
    providerCodeOf(e) === 'LimitExceeded.PhoneNumberDailyLimit'
      ? ok('Response.Error 保留 providerCode')
      : bad(`providerCode 不符: ${providerCodeOf(e) ?? 'missing'}`)
  }

  // 5) 发送状态非 Ok → 抛 SMS_SEND_FAILED
  nextResponse = { Response: { SendStatusSet: [{ Code: 'FailedOperation.SignatureIncorrectOrUnapproved', Message: 'x' }], RequestId: 'r5' } }
  try { await sender.sendCode('13800000000', '222222'); bad('状态非 Ok 应抛错') }
  catch (e) {
    (e as Error).message === 'SMS_SEND_FAILED' ? ok('状态非 Ok → 抛 SMS_SEND_FAILED') : bad(`错误信息不符: ${(e as Error).message}`)
    providerCodeOf(e) === 'FailedOperation.SignatureIncorrectOrUnapproved'
      ? ok('状态非 Ok 保留 providerCode')
      : bad(`providerCode 不符: ${providerCodeOf(e) ?? 'missing'}`)
  }

  finish()
}

function finish(): void {
  server.close()
  console.log(`\n${fail ? '❌ FAIL' : '✅ ALL PASS'} (pass=${pass} fail=${fail})`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); server.close(); process.exit(1) })
