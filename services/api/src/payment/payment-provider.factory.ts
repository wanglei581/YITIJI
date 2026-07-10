/**
 * 支付 Provider 工厂/注册表（fail-closed，仿 resolveSmsProvider / AI_PROVIDER 模式）。
 *
 * `PAYMENT_PROVIDER` 取值（逗号分隔可多通道）：
 * - 未设置 / disabled → 空注册表：线上支付关闭；pay 端点返回明确错误码，不伪装可支付。
 * - sandbox → 测试通道（C5-2）：SANDBOX_PAYMENT_SECRET 缺失/过短 → 启动即抛错；
 *   NODE_ENV=production → 启动即抛错；**不得与真实通道混跑**（sandbox 与 wechat/alipay 互斥）。
 * - wechat / alipay / "wechat,alipay" → C5-6 真实渠道：任一关键配置缺失 → 启动即抛错，
 *   绝不静默回退、绝不带残缺配置跑真实资金通道。
 * - 其它任何取值 → 启动即抛错。
 *
 * 密钥材料只经服务端 env 加载：`*_PEM`（内联 PEM，`\n` 字面量会被还原）或 `*_PATH`
 * （服务器本地文件路径）。仓库/前端/Kiosk/Agent 一律不得出现真实密钥。
 */
import { readFileSync } from 'fs'
import type { PaymentChannel } from './payment.types'
import type { PaymentProvider } from './payment-provider.types'
import { AlipayProvider } from './providers/alipay.provider'
import { SandboxPaymentProvider } from './providers/sandbox-payment.provider'
import { WechatPayProvider } from './providers/wechat-pay.provider'

/** Nest 注入 token（PaymentModule 用 useFactory 注册；注入值为 PaymentProviderRegistry）。 */
export const PAYMENT_PROVIDER_TOKEN = 'PAYMENT_PROVIDER_TOKEN'

const WECHAT_API_BASE_DEFAULT = 'https://api.mch.weixin.qq.com'
const ALIPAY_GATEWAY_DEFAULT = 'https://openapi.alipay.com/gateway.do'

/** 已启用通道注册表；size=0 表示线上支付关闭（业务层返回 ONLINE_PAYMENT_DISABLED）。 */
export class PaymentProviderRegistry {
  private readonly providers: Map<PaymentChannel, PaymentProvider>

  constructor(providers: readonly PaymentProvider[]) {
    this.providers = new Map(providers.map((p) => [p.channel, p]))
  }

  get(channel: string): PaymentProvider | null {
    return this.providers.get(channel as PaymentChannel) ?? null
  }

  channels(): PaymentChannel[] {
    return [...this.providers.keys()]
  }

  get size(): number {
    return this.providers.size
  }
}

/**
 * 读取 PEM 材料：优先 `${base}_PEM`（内联，还原 `\n` 字面量），否则 `${base}_PATH` 读文件。
 * 都缺失返回 ''（由 Provider 构造器统一 fail-closed 报缺）。
 */
function readPemMaterial(env: NodeJS.ProcessEnv, base: string): string {
  const inline = env[`${base}_PEM`]?.trim()
  if (inline) return inline.replace(/\\n/g, '\n')
  const path = env[`${base}_PATH`]?.trim()
  if (path) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      throw new Error(`${base}_PATH_UNREADABLE: 无法读取密钥文件（检查路径与权限；不回显路径内容）`)
    }
  }
  return ''
}

function requireNotifyBaseUrl(env: NodeJS.ProcessEnv): string {
  const raw = env['PAYMENT_NOTIFY_BASE_URL']?.trim() ?? ''
  if (!raw) {
    throw new Error('PAYMENT_NOTIFY_BASE_URL_MISSING: 启用真实支付通道必须配置回调公网 base（https）')
  }
  if (env['NODE_ENV'] === 'production' && !raw.startsWith('https://')) {
    throw new Error('PAYMENT_NOTIFY_BASE_URL_INSECURE: 生产环境回调 base 必须为 https')
  }
  if (!/^https?:\/\//.test(raw)) {
    throw new Error('PAYMENT_NOTIFY_BASE_URL_INVALID: 必须为 http(s) URL')
  }
  return raw
}

function buildWechatProvider(env: NodeJS.ProcessEnv): WechatPayProvider {
  return new WechatPayProvider({
    mchid: env['WECHAT_PAY_MCHID']?.trim() ?? '',
    appid: env['WECHAT_PAY_APPID']?.trim() ?? '',
    mchSerialNo: env['WECHAT_PAY_MCH_SERIAL_NO']?.trim() ?? '',
    privateKeyPem: readPemMaterial(env, 'WECHAT_PAY_PRIVATE_KEY'),
    apiV3Key: env['WECHAT_PAY_APIV3_KEY'] ?? '',
    platformPublicKeyPem: readPemMaterial(env, 'WECHAT_PAY_PUBLIC_KEY'),
    platformPublicKeyId: env['WECHAT_PAY_PUBLIC_KEY_ID']?.trim() ?? '',
    notifyBaseUrl: requireNotifyBaseUrl(env),
    apiBaseUrl: env['WECHAT_PAY_API_BASE']?.trim() || WECHAT_API_BASE_DEFAULT,
    codePayStoreOutId: env['WECHAT_PAY_CODEPAY_STORE_OUT_ID']?.trim(),
  })
}

function buildAlipayProvider(env: NodeJS.ProcessEnv): AlipayProvider {
  return new AlipayProvider({
    appId: env['ALIPAY_APP_ID']?.trim() ?? '',
    appPrivateKeyPem: readPemMaterial(env, 'ALIPAY_APP_PRIVATE_KEY'),
    alipayPublicKeyPem: readPemMaterial(env, 'ALIPAY_PUBLIC_KEY'),
    notifyBaseUrl: requireNotifyBaseUrl(env),
    gatewayUrl: env['ALIPAY_GATEWAY_URL']?.trim() || ALIPAY_GATEWAY_DEFAULT,
  })
}

export function resolvePaymentProviders(env: NodeJS.ProcessEnv = process.env): PaymentProviderRegistry {
  const raw = env['PAYMENT_PROVIDER']?.trim().toLowerCase() ?? ''
  if (!raw || raw === 'disabled') return new PaymentProviderRegistry([])

  const requested = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
  const unknown = requested.filter((c) => c !== 'sandbox' && c !== 'wechat' && c !== 'alipay')
  if (unknown.length > 0) {
    throw new Error(
      `PAYMENT_PROVIDER_INVALID: 未知取值 "${unknown.join(',')}"（允许 未设置/disabled/sandbox/wechat/alipay，逗号分隔可多通道）`,
    )
  }
  if (requested.includes('sandbox') && requested.length > 1) {
    // 测试通道与真实资金通道绝不混跑：混配即拒绝启动，防止测试码/真实码在同一台机上并存。
    throw new Error('PAYMENT_PROVIDER_SANDBOX_EXCLUSIVE: sandbox 不得与 wechat/alipay 混配')
  }

  const providers: PaymentProvider[] = []
  for (const channel of requested) {
    if (channel === 'sandbox') {
      if (env['NODE_ENV'] === 'production') {
        throw new Error(
          'PAYMENT_PROVIDER_SANDBOX_FORBIDDEN_IN_PRODUCTION: 生产环境禁止沙箱支付通道（生产只允许 disabled / wechat / alipay）',
        )
      }
      providers.push(new SandboxPaymentProvider(env['SANDBOX_PAYMENT_SECRET'] ?? ''))
    } else if (channel === 'wechat') {
      providers.push(buildWechatProvider(env))
    } else {
      providers.push(buildAlipayProvider(env))
    }
  }
  return new PaymentProviderRegistry(providers)
}

/**
 * @deprecated C5-2 单通道旧接口，仅存量 verify 脚本引用。
 * 空注册表返回 null；单通道返回该 Provider；多通道请改用 resolvePaymentProviders。
 */
export function resolvePaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider | null {
  const registry = resolvePaymentProviders(env)
  if (registry.size === 0) return null
  const channels = registry.channels()
  if (channels.length > 1) {
    throw new Error('PAYMENT_PROVIDER_MULTIPLE: 多通道配置请使用 resolvePaymentProviders')
  }
  const first = channels[0]
  return first ? registry.get(first) : null
}
