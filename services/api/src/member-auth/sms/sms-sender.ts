import { Injectable, Logger } from '@nestjs/common'
import { maskPhone } from '../../common/crypto/phone-identity'

export const SMS_SENDER = Symbol('SMS_SENDER')

/**
 * 短信发送抽象。阶段 A 只实现 LogSmsSender(开发联调用)。
 * 真实服务商(阿里云短信 / 腾讯云短信)作为"待决策"项后续接入,密钥进 .env。
 */
export interface SmsSender {
  sendCode(phone: string, code: string): Promise<void>
}

/**
 * 开发用短信发送器:把验证码打到服务端日志(脱敏手机号),不返回前端。
 * 生产环境严禁使用 —— 一旦 NODE_ENV=production 仍走到这里,只告警不打印验证码,
 * 避免明文验证码进生产日志。
 */
@Injectable()
export class LogSmsSender implements SmsSender {
  private readonly logger = new Logger('LogSmsSender')

  async sendCode(phone: string, code: string): Promise<void> {
    if (process.env['NODE_ENV'] === 'production') {
      this.logger.error(
        `生产环境未配置真实短信服务商,验证码未发送(手机号 ${maskPhone(phone)})。请接入阿里云/腾讯云短信。`,
      )
      return
    }
    this.logger.warn(`[DEV 短信] ${maskPhone(phone)} 验证码: ${code}(仅开发环境打印,生产替换为真实服务商)`)
  }
}
