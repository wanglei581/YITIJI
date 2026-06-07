import { Injectable, Logger } from '@nestjs/common'
import { maskPhone } from '../../common/crypto/phone-identity'

export const SMS_SENDER = Symbol('SMS_SENDER')

export type SmsProvider = 'log' | 'tencent'

/**
 * 短信发送抽象。
 *
 * 当前支持:
 * - log:开发联调用,验证码只打服务端日志。
 * - tencent:腾讯云短信预留接口;待短信服务审核通过并拿到模板/签名/密钥后补真实 API 调用。
 */
export interface SmsSender {
  sendCode(phone: string, code: string): Promise<void>
}

interface TencentSmsConfig {
  secretId: string
  secretKey: string
  sdkAppId: string
  signName: string
  templateId: string
  region: string
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

/**
 * 腾讯云短信发送器预留位。
 *
 * 这里先完成 provider 选择、启动期配置校验与安全失败语义,不引入腾讯云 SDK,
 * 不拼真实 API 请求,也不打印验证码。短信服务审核通过后,只需要在本类中补
 * SendSms API 调用,MemberAuthService 与前端登录流程无需再改。
 */
export class TencentSmsSender implements SmsSender {
  private readonly logger = new Logger('TencentSmsSender')

  constructor(private readonly config: TencentSmsConfig) {}

  async sendCode(phone: string, _code: string): Promise<void> {
    this.logger.error(
      `腾讯云短信接口已预留但真实发送尚未接入,本次未发送验证码(手机号 ${maskPhone(phone)}, region=${this.config.region}, templateId=${this.config.templateId})。`,
    )
    throw new Error('SMS_PROVIDER_TENCENT_NOT_IMPLEMENTED')
  }
}
