/**
 * 生产运行时启动门禁（fail-closed）。
 *
 * 集中校验 NODE_ENV=production 时的安全底线，启动期一次性断言，缺一即拒启动：
 *   - JWT_SECRET 必须存在且长度 >= 16（杜绝不安全回退签密钥）
 *   - FILE_STORAGE_DRIVER 必须为 cos（生产不得回退本地磁盘存储，合规要求落 COS）
 *   - DATABASE_URL 不得为 file: SQLite（委托 assertRuntimeDatabaseAllowed，与现有
 *     verify:production-db-guard 共用同一判定，避免双份口径漂移）
 *   - REDIS_URL 必须存在（会员会话、队列、幂等和防重放依赖 Redis）
 *   - SMS_PROVIDER 必须为 tencent，且腾讯短信生产参数齐全（生产不得日志打印验证码）
 *   - OCR_PROVIDER 必须为 baidu，且百度 OCR 生产参数齐全（生产不得关闭真实简历识别）
 *   - AI_PROVIDER 必须为 llm，且真实 LLM 密钥齐全（生产不得回退 mock / stub provider）
 *   - PAYMENT_SESSION_SECRET 必须存在且长度 >= 32（打印建单后签发短期支付会话 token，
 *     生产不得回退 JWT_SECRET / FILE_SIGNING_SECRET）
 *   - PAYMENT_PROVIDER 不得含 sandbox（生产禁止沙箱支付通道；wechat/alipay 真实渠道
 *     由 Provider 工厂启动期校验凭证齐全，缺一拒启动）
 *   - PRINT_REQUIRE_PAID_BEFORE_CLAIM 必须显式声明 true|false（C5-6：未支付订单能否被
 *     claim 出纸是显式部署决策）；启用 wechat/alipay 时必须为 true（先付后印）
 *
 * 非生产环境一律放行：开发 / CI 用本地 SQLite + local 存储 + 测试密钥，不受此门禁约束。
 */
import { assertRuntimeDatabaseAllowed } from '../prisma/create-client'

export interface ProductionRuntimeEnv {
  NODE_ENV?: string
  JWT_SECRET?: string
  FILE_STORAGE_DRIVER?: string
  DATABASE_URL?: string
  REDIS_URL?: string
  SMS_PROVIDER?: string
  TENCENT_SMS_SECRET_ID?: string
  TENCENT_SMS_SECRET_KEY?: string
  TENCENT_SMS_SDK_APP_ID?: string
  TENCENT_SMS_SIGN_NAME?: string
  TENCENT_SMS_TEMPLATE_ID?: string
  OCR_PROVIDER?: string
  BAIDU_OCR_API_KEY?: string
  BAIDU_OCR_SECRET_KEY?: string
  AI_PROVIDER?: string
  AI_LLM_API_KEY?: string
  TRTC_LLM_API_KEY?: string
  PAYMENT_SESSION_SECRET?: string
  PAYMENT_PROVIDER?: string
  PRINT_REQUIRE_PAID_BEFORE_CLAIM?: string
}

const MIN_JWT_SECRET_LENGTH = 16
const MIN_PAYMENT_SESSION_SECRET_LENGTH = 32
const REQUIRED_TENCENT_SMS_KEYS = [
  'TENCENT_SMS_SECRET_ID',
  'TENCENT_SMS_SECRET_KEY',
  'TENCENT_SMS_SDK_APP_ID',
  'TENCENT_SMS_SIGN_NAME',
  'TENCENT_SMS_TEMPLATE_ID',
] as const

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

export function assertProductionRuntimeGates(
  env: ProductionRuntimeEnv = process.env,
): void {
  const nodeEnv = env.NODE_ENV
  if (nodeEnv !== 'production') return

  const jwtSecret = env.JWT_SECRET
  if (!jwtSecret || jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `PRODUCTION_JWT_SECRET_INVALID: NODE_ENV=production 时 JWT_SECRET 必须存在且长度 >= ${MIN_JWT_SECRET_LENGTH} 字符`,
    )
  }

  const driver = env.FILE_STORAGE_DRIVER?.trim()
  if (driver !== 'cos') {
    throw new Error(
      `PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS: NODE_ENV=production 时 FILE_STORAGE_DRIVER 必须为 cos（当前: ${driver || '未设置'}）`,
    )
  }

  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'PRODUCTION_DATABASE_URL_MISSING: NODE_ENV=production 时 DATABASE_URL 必须配置',
    )
  }
  assertRuntimeDatabaseAllowed(databaseUrl, nodeEnv)

  if (!hasValue(env.REDIS_URL)) {
    throw new Error(
      'PRODUCTION_REDIS_URL_MISSING: NODE_ENV=production 时 REDIS_URL 必须配置',
    )
  }

  const smsProvider = env.SMS_PROVIDER?.trim().toLowerCase()
  if (smsProvider !== 'tencent') {
    throw new Error(
      `PRODUCTION_SMS_PROVIDER_NOT_TENCENT: NODE_ENV=production 时 SMS_PROVIDER 必须为 tencent（当前: ${smsProvider || '未设置'}）`,
    )
  }
  const missingSmsKeys = REQUIRED_TENCENT_SMS_KEYS.filter((key) => !hasValue(env[key]))
  if (missingSmsKeys.length > 0) {
    throw new Error(
      `PRODUCTION_TENCENT_SMS_CONFIG_MISSING: SMS_PROVIDER=tencent 时必须配置 ${missingSmsKeys.join(', ')}`,
    )
  }

  const ocrProvider = env.OCR_PROVIDER?.trim().toLowerCase()
  if (ocrProvider !== 'baidu') {
    throw new Error(
      `PRODUCTION_OCR_PROVIDER_NOT_BAIDU: NODE_ENV=production 时 OCR_PROVIDER 必须为 baidu（当前: ${ocrProvider || '未设置'}）`,
    )
  }
  if (!hasValue(env.BAIDU_OCR_API_KEY) || !hasValue(env.BAIDU_OCR_SECRET_KEY)) {
    throw new Error(
      'PRODUCTION_BAIDU_OCR_CONFIG_MISSING: OCR_PROVIDER=baidu 时必须配置 BAIDU_OCR_API_KEY 和 BAIDU_OCR_SECRET_KEY',
    )
  }

  const aiProvider = env.AI_PROVIDER?.trim().toLowerCase()
  if (aiProvider !== 'llm') {
    throw new Error(
      `PRODUCTION_AI_PROVIDER_NOT_LLM: NODE_ENV=production 时 AI_PROVIDER 必须为 llm（当前: ${aiProvider || '未设置'}）`,
    )
  }
  if (!hasValue(env.AI_LLM_API_KEY) && !hasValue(env.TRTC_LLM_API_KEY)) {
    throw new Error(
      'PRODUCTION_LLM_CONFIG_MISSING: AI_PROVIDER=llm 时必须配置 AI_LLM_API_KEY 或 TRTC_LLM_API_KEY',
    )
  }

  const paymentSessionSecret = env.PAYMENT_SESSION_SECRET
  if (!paymentSessionSecret || paymentSessionSecret.length < MIN_PAYMENT_SESSION_SECRET_LENGTH) {
    throw new Error(
      `PRODUCTION_PAYMENT_SESSION_SECRET_INVALID: NODE_ENV=production 时 PAYMENT_SESSION_SECRET 必须存在且长度 >= ${MIN_PAYMENT_SESSION_SECRET_LENGTH} 字符`,
    )
  }

  // C5-2/C5-6：生产禁止沙箱支付通道（测试通道绝不能在生产入账）。未设置/disabled = 线上支付关闭，放行；
  // wechat / alipay（可逗号并列）为 C5-6 真实渠道，凭证齐全性由 Provider 工厂启动期校验（fail-closed）。
  const paymentProvider = env.PAYMENT_PROVIDER?.trim().toLowerCase() ?? ''
  const paymentChannels = paymentProvider && paymentProvider !== 'disabled'
    ? paymentProvider.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  if (paymentChannels.includes('sandbox')) {
    throw new Error(
      'PRODUCTION_PAYMENT_PROVIDER_SANDBOX_FORBIDDEN: NODE_ENV=production 时 PAYMENT_PROVIDER 不得含 sandbox（生产只允许 disabled / wechat / alipay）',
    )
  }
  const realChannelEnabled = paymentChannels.some((c) => c === 'wechat' || c === 'alipay')

  // C5-6 paid-before-claim 门禁「按部署环境显式开启」：
  // - 生产必须**显式**声明 PRINT_REQUIRE_PAID_BEFORE_CLAIM=true|false，不允许沉默缺省 ——
  //   缺省 false 会让付费单未支付即被 Agent claim 出纸，这类资金风险必须是显式决策。
  // - 启用真实支付通道（wechat/alipay）时必须为 true：收真钱就必须先付后印，无豁免。
  const paidBeforeClaim = env.PRINT_REQUIRE_PAID_BEFORE_CLAIM?.trim()
  if (paidBeforeClaim !== 'true' && paidBeforeClaim !== 'false') {
    throw new Error(
      'PRODUCTION_PAID_BEFORE_CLAIM_UNDECLARED: NODE_ENV=production 时必须显式设置 PRINT_REQUIRE_PAID_BEFORE_CLAIM=true|false（未支付订单是否禁止 claim 出纸必须是显式部署决策）',
    )
  }
  if (realChannelEnabled && paidBeforeClaim !== 'true') {
    throw new Error(
      'PRODUCTION_PAID_BEFORE_CLAIM_REQUIRED: 启用真实支付通道（wechat/alipay）时 PRINT_REQUIRE_PAID_BEFORE_CLAIM 必须为 true（先付后印，服务端门禁）',
    )
  }
}
