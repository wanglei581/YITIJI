/**
 * 支付 Provider 工厂（fail-closed，仿 resolveSmsProvider / AI_PROVIDER 模式）：
 *
 * - 未设置 / disabled → null：线上支付关闭；pay 端点返回明确错误码，不伪装可支付。
 * - sandbox → SandboxPaymentProvider：SANDBOX_PAYMENT_SECRET 缺失/过短 → 启动即抛错；
 *   NODE_ENV=production → 启动即抛错（与 production-runtime-gates 双保险）。
 * - 其它任何取值（wechat / alipay / ...）→ 启动即抛错：C5-6 真实渠道适配前不放行，
 *   绝不静默回退、绝不引入 live 商户密钥。
 */
import type { PaymentProvider } from './payment-provider.types'
import { SandboxPaymentProvider } from './providers/sandbox-payment.provider'

/** Nest 注入 token（PaymentModule 用 useFactory 注册）。 */
export const PAYMENT_PROVIDER_TOKEN = 'PAYMENT_PROVIDER_TOKEN'

export function resolvePaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider | null {
  const raw = env['PAYMENT_PROVIDER']?.trim().toLowerCase() ?? ''
  if (!raw || raw === 'disabled') return null
  if (raw === 'sandbox') {
    if (env['NODE_ENV'] === 'production') {
      throw new Error(
        'PAYMENT_PROVIDER_SANDBOX_FORBIDDEN_IN_PRODUCTION: 生产环境禁止沙箱支付通道（真实渠道到 C5-6；此前生产保持未设置/disabled）',
      )
    }
    return new SandboxPaymentProvider(env['SANDBOX_PAYMENT_SECRET'] ?? '')
  }
  throw new Error(
    `PAYMENT_PROVIDER_INVALID: 未知取值 "${raw}"（本波只允许 未设置/disabled/sandbox；wechat/alipay 到 C5-6 真实渠道适配）`,
  )
}
