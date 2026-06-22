import { Injectable, Logger } from '@nestjs/common'
import { maskPhone } from '../../common/crypto/phone-identity'
import { tc3Sign } from '../../common/tencent/tc3'

export const SMS_SENDER = Symbol('SMS_SENDER')

export type SmsProvider = 'log' | 'tencent'

/**
 * 短信发送抽象。
 *
 * 当前支持:
 * - log:开发联调用,验证码只打服务端日志。
 * - tencent:腾讯云短信，已接入真实 SendSms API 调用（TC3-HMAC-SHA256 签名）。
 *   上线还需:① 短信签名/模板审核通过拿到 SignName/TemplateId/SDKAppID;② 真实 CAM 密钥进
 *   服务端 env;③ 真号 E2E 验收。三者齐备后置 SMS_PROVIDER=tencent 即可真发。
 */
export interface SmsSender {
  sendCode(phone: string, code: string): Promise<void>
}

export class SmsSendError extends Error {
  constructor(readonly providerCode?: string) {
    super('SMS_SEND_FAILED')
    this.name = 'SmsSendError'
  }
}

interface TencentSmsConfig {
  secretId: string
  secretKey: string
  sdkAppId: string
  signName: string
  templateId: string
  region: string
  /** 短信 API Host（默认 sms.tencentcloudapi.com；本地 stub 测试可指向 127.0.0.1:port） */
  host: string
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} 未配置。SMS_PROVIDER=tencent 时必须配置腾讯云短信参数。`)
  }
  return value
}

export function resolveSmsProvider(): SmsProvider {
  const raw = process.env['SMS_PROVIDER']?.trim().toLowerCase()
  if (!raw) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('生产环境必须显式配置 SMS_PROVIDER=tencent，不能使用开发日志短信。')
    }
    return 'log'
  }

  if (raw === 'log') {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('生产环境禁止 SMS_PROVIDER=log，请配置 SMS_PROVIDER=tencent。')
    }
    return 'log'
  }

  if (raw === 'tencent') return 'tencent'

  throw new Error(`不支持的 SMS_PROVIDER=${raw}，允许值: log / tencent。`)
}

function readTencentSmsConfig(): TencentSmsConfig {
  return {
    secretId: requireEnv('TENCENT_SMS_SECRET_ID'),
    secretKey: requireEnv('TENCENT_SMS_SECRET_KEY'),
    sdkAppId: requireEnv('TENCENT_SMS_SDK_APP_ID'),
    signName: requireEnv('TENCENT_SMS_SIGN_NAME'),
    templateId: requireEnv('TENCENT_SMS_TEMPLATE_ID'),
    region: process.env['TENCENT_SMS_REGION']?.trim() || 'ap-guangzhou',
    host: process.env['TENCENT_SMS_HOST']?.trim() || 'sms.tencentcloudapi.com',
  }
}

export function createSmsSender(): SmsSender {
  const provider = resolveSmsProvider()
  if (provider === 'tencent') {
    return new TencentSmsSender(readTencentSmsConfig())
  }
  return new LogSmsSender()
}

/**
 * 开发用短信发送器:把验证码打到服务端日志(脱敏手机号),不返回前端。
 * 生产环境通过 resolveSmsProvider() 禁止选择 log,避免明文验证码进生产日志。
 */
@Injectable()
export class LogSmsSender implements SmsSender {
  private readonly logger = new Logger('LogSmsSender')

  async sendCode(phone: string, code: string): Promise<void> {
    this.logger.warn(`[DEV 短信] ${maskPhone(phone)} 验证码: ${code}(仅开发环境打印,生产替换为真实服务商)`)
  }
}

/** 腾讯云短信 SendSms API 版本（国内短信）。 */
const SMS_API_VERSION = '2021-01-11'

/**
 * 腾讯云短信发送器（真实接入）。
 *
 * - 用共享 TC3-HMAC-SHA256 签名（common/tencent/tc3.ts，与 ASR/TTS 同一套），密钥仅服务端。
 * - 模板参数顺序见 docs/compliance/launch-review-submissions.md §A.2：{1}=验证码、{2}=有效期分钟。
 *   单参数模板只传 [code]；若选用带有效期的双参数模板，配 TENCENT_SMS_CODE_EXPIRE_MINUTES
 *   （须与 MemberAuthService 的实际验证码 TTL 一致）→ 传 [code, minutes]。
 * - 绝不记录验证码：日志只含脱敏手机号 + 腾讯云返回码 + RequestId。
 * - 任何失败统一抛 SMS_SEND_FAILED，并保留非敏感供应商 code 供 service 层做用户友好分类。
 */
export class TencentSmsSender implements SmsSender {
  private readonly logger = new Logger('TencentSmsSender')

  constructor(private readonly config: TencentSmsConfig) {}

  async sendCode(phone: string, code: string): Promise<void> {
    const host = this.config.host
    // 本地 stub（127.0.0.1/localhost）走 http，便于无外网联调；真实腾讯云始终 https。
    const insecure = host.startsWith('127.0.0.1') || host.startsWith('localhost')
    // 腾讯云要求 E.164（带国家码）；大陆手机号补 +86，已带 + 则原样。
    const e164 = phone.startsWith('+') ? phone : `+86${phone}`

    const expireMinutes = (process.env['TENCENT_SMS_CODE_EXPIRE_MINUTES'] ?? '').trim()
    const templateParamSet = expireMinutes ? [code, expireMinutes] : [code]

    const payload = JSON.stringify({
      PhoneNumberSet: [e164],
      SmsSdkAppId: this.config.sdkAppId,
      SignName: this.config.signName,
      TemplateId: this.config.templateId,
      TemplateParamSet: templateParamSet,
    })
    const ts = Math.floor(Date.now() / 1000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number(process.env['TENCENT_SMS_TIMEOUT_MS']) || 10_000)
    try {
      const res = await fetch(`${insecure ? 'http' : 'https'}://${host}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: tc3Sign({
            host: host.split(':')[0],
            service: 'sms',
            payload,
            ts,
            secretId: this.config.secretId,
            secretKey: this.config.secretKey,
          }),
          'X-TC-Action': 'SendSms',
          'X-TC-Version': SMS_API_VERSION,
          'X-TC-Timestamp': String(ts),
          'X-TC-Region': this.config.region,
        },
        body: payload,
        signal: controller.signal,
      })
      const body = (await res.json()) as {
        Response?: {
          Error?: { Code?: string; Message?: string }
          RequestId?: string
          SendStatusSet?: Array<{ Code?: string; Message?: string }>
        }
      }
      const requestId = body.Response?.RequestId ?? '?'
      const apiError = body.Response?.Error
      if (apiError) {
        // 只记元数据：脱敏手机号 + 腾讯云错误码 + RequestId，绝不记验证码。
        this.logger.error(`SMS 下发失败(API) phone=${maskPhone(phone)} code=${apiError.Code ?? '?'} requestId=${requestId}`)
        throw new SmsSendError(apiError.Code)
      }
      const status = body.Response?.SendStatusSet?.[0]
      if (!status || status.Code !== 'Ok') {
        this.logger.error(`SMS 下发失败(状态) phone=${maskPhone(phone)} code=${status?.Code ?? 'empty'} requestId=${requestId}`)
        throw new SmsSendError(status?.Code ?? 'empty')
      }
      this.logger.log(`SMS 下发成功 phone=${maskPhone(phone)} requestId=${requestId}`)
    } catch (e) {
      if (e instanceof SmsSendError) throw e
      const reason = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network'
      this.logger.error(`SMS 下发异常 phone=${maskPhone(phone)} reason=${reason}`)
      throw new SmsSendError(reason)
    } finally {
      clearTimeout(timer)
    }
  }
}
