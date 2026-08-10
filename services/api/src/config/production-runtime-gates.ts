/**
 * 生产运行时启动门禁（fail-closed）。
 *
 * 集中校验 NODE_ENV=production 时的安全底线，启动期一次性断言，缺一即拒启动：
 *   - JWT_SECRET 必须存在且长度 >= 16（杜绝不安全回退签密钥）
 *   - FILE_STORAGE_DRIVER 必须为 cos 或 bos（生产不得回退本地磁盘存储）
 *   - 所选对象存储的服务端凭证、私有桶和区域配置必须齐全
 *   - BOS 迁移期必须显式保留 COS 作为 legacy provider，避免历史运营素材误读本地
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
 *   - PRINT_REQUIRE_PII_SCAN 必须为 true（用户原始材料未完成隐私检查与逐项裁决时，
 *     生产环境不得创建打印任务）
 *   - PRINT_SCAN_CAPABILITY_MODE 必须显式声明 managed|strict（Task 11：打印扫描能力开关
 *     是每终端 × 能力键的 DB 配置，未配置行在 managed 模式放行既有闭环、strict 模式
 *     fail-closed 拒绝；选哪种是显式部署决策，生产不允许沉默缺省）
 *   - TRUST_PROXY_HOPS 必须显式声明 1..9（nginx 等反代可信跳数；禁止 true/false）
 *   - TERMINAL_LEGACY_REGISTER_ENABLED 必须显式为 false（新设备只允许 Admin 预创建
 *     + 一次性绑定码激活；共享 adminSecret 旧注册面不得在生产开放）
 *   - TERMINAL_PLANNED_PROVISIONING_ENABLED 必须显式声明 true|false；滚动部署第一阶段保持
 *     false，所有 API 实例升级且旧 binary 退出后再切 true
 *
 * 非生产环境一律放行：开发 / CI 用本地 SQLite + local 存储 + 测试密钥，不受此门禁约束。
 */
import { assertRuntimeDatabaseAllowed } from '../prisma/create-client'
import { assertProductionTrustProxyHops } from './trust-proxy'

export interface ProductionRuntimeEnv {
  NODE_ENV?: string
  JWT_SECRET?: string
  FILE_STORAGE_DRIVER?: string
  FILE_STORAGE_LEGACY_DRIVER?: string
  TENCENT_COS_SECRET_ID?: string
  TENCENT_COS_SECRET_KEY?: string
  TENCENT_COS_BUCKET?: string
  TENCENT_COS_REGION?: string
  BAIDU_BOS_ACCESS_KEY_ID?: string
  BAIDU_BOS_SECRET_ACCESS_KEY?: string
  BAIDU_BOS_BUCKET?: string
  BAIDU_BOS_REGION?: string
  BAIDU_BOS_ENDPOINT?: string
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
  PRINT_REQUIRE_PII_SCAN?: string
  PRINT_SCAN_CAPABILITY_MODE?: string
  TRUST_PROXY_HOPS?: string
  TERMINAL_LEGACY_REGISTER_ENABLED?: string
  TERMINAL_PLANNED_PROVISIONING_ENABLED?: string
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
const REQUIRED_COS_KEYS = [
  'TENCENT_COS_SECRET_ID',
  'TENCENT_COS_SECRET_KEY',
  'TENCENT_COS_BUCKET',
  'TENCENT_COS_REGION',
] as const
const REQUIRED_BOS_KEYS = [
  'BAIDU_BOS_ACCESS_KEY_ID',
  'BAIDU_BOS_SECRET_ACCESS_KEY',
  'BAIDU_BOS_BUCKET',
  'BAIDU_BOS_REGION',
  'BAIDU_BOS_ENDPOINT',
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
  if (driver !== 'cos' && driver !== 'bos') {
    throw new Error(
      `PRODUCTION_FILE_STORAGE_DRIVER_UNSUPPORTED: NODE_ENV=production 时 FILE_STORAGE_DRIVER 必须为 cos 或 bos（当前: ${driver || '未设置'}）`,
    )
  }
  const requiredStorageKeys = driver === 'cos' ? REQUIRED_COS_KEYS : REQUIRED_BOS_KEYS
  const missingStorageKeys = requiredStorageKeys.filter((key) => !hasValue(env[key]))
  if (missingStorageKeys.length > 0) {
    throw new Error(
      `PRODUCTION_FILE_STORAGE_CONFIG_MISSING: FILE_STORAGE_DRIVER=${driver} 时必须配置 ${missingStorageKeys.join(', ')}`,
    )
  }
  if (driver === 'bos') {
    if (env.FILE_STORAGE_LEGACY_DRIVER?.trim() !== 'cos') {
      throw new Error(
        'PRODUCTION_FILE_STORAGE_LEGACY_DRIVER_INVALID: FILE_STORAGE_DRIVER=bos 迁移期必须显式配置 FILE_STORAGE_LEGACY_DRIVER=cos',
      )
    }
    const missingLegacyCosKeys = REQUIRED_COS_KEYS.filter((key) => !hasValue(env[key]))
    if (missingLegacyCosKeys.length > 0) {
      throw new Error(
        `PRODUCTION_LEGACY_COS_CONFIG_MISSING: BOS 迁移期读取历史文件必须配置 ${missingLegacyCosKeys.join(', ')}`,
      )
    }
    let endpoint: URL
    try {
      endpoint = new URL(env.BAIDU_BOS_ENDPOINT!)
    } catch {
      throw new Error('PRODUCTION_BAIDU_BOS_ENDPOINT_INVALID: BAIDU_BOS_ENDPOINT 必须为 HTTPS regional endpoint')
    }
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      !/(^|\.)bcebos\.com$/i.test(endpoint.hostname) ||
      endpoint.port ||
      (endpoint.pathname !== '/' && endpoint.pathname !== '') ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new Error('PRODUCTION_BAIDU_BOS_ENDPOINT_INVALID: BAIDU_BOS_ENDPOINT 必须为 HTTPS regional endpoint')
    }
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

  // 商用隐私底线：生产环境不保留“只审计、不拦截”的观察模式。
  // 必须与 print-jobs.service.ts 的精确 `=== 'true'` 判定一致，避免带空格或大小写
  // 变体通过启动门禁、运行时却仍走 bypass。
  if (env.PRINT_REQUIRE_PII_SCAN !== 'true') {
    throw new Error(
      'PRODUCTION_PRINT_PII_SCAN_REQUIRED: NODE_ENV=production 时 PRINT_REQUIRE_PII_SCAN 必须显式为 true（用户原始材料未完成隐私检查不得建打印任务）',
    )
  }

  // Task 11：print-scan feature gate 配置模式必须显式声明。能力开关是每终端 × 能力键
  // 的 DB 配置（TerminalCapability），未配置行的语义由本 env 决定：
  //   managed = 未配置行放行既有已验证闭环（管理员按需接管）
  //   strict  = 未配置行 fail-closed 拒绝（全部能力必须显式验收后配置）
  // 生产沉默缺省会让"能力开关是否接管"变成隐式状态，必须显式决策。
  const capabilityMode = env.PRINT_SCAN_CAPABILITY_MODE?.trim().toLowerCase()
  if (capabilityMode !== 'managed' && capabilityMode !== 'strict') {
    throw new Error(
      'PRODUCTION_PRINT_SCAN_CAPABILITY_MODE_UNDECLARED: NODE_ENV=production 时必须显式设置 PRINT_SCAN_CAPABILITY_MODE=managed|strict（print-scan 能力开关未配置行的放行/拒绝语义必须是显式部署决策）',
    )
  }

  // 反代可信跳数：生产必须显式声明，禁止 trust proxy=true。
  assertProductionTrustProxyHops(env)

  if (env.TERMINAL_LEGACY_REGISTER_ENABLED?.trim().toLowerCase() !== 'false') {
    throw new Error(
      'PRODUCTION_TERMINAL_LEGACY_REGISTER_FORBIDDEN: NODE_ENV=production 时 TERMINAL_LEGACY_REGISTER_ENABLED 必须显式为 false（新设备只允许 Admin 预创建 + 一次性绑定码激活）',
    )
  }
  const plannedProvisioning = env.TERMINAL_PLANNED_PROVISIONING_ENABLED?.trim().toLowerCase()
  if (plannedProvisioning !== 'true' && plannedProvisioning !== 'false') {
    throw new Error(
      'PRODUCTION_TERMINAL_PLANNED_PROVISIONING_UNDECLARED: NODE_ENV=production 时 TERMINAL_PLANNED_PROVISIONING_ENABLED 必须显式为 true|false（滚动部署阶段必须保持 false，全实例升级后才切 true）',
    )
  }
}
