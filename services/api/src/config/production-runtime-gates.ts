/**
 * 生产运行时启动门禁（fail-closed）。
 *
 * 集中校验 NODE_ENV=production 时的安全底线，启动期一次性断言，缺一即拒启动：
 *   - JWT_SECRET 必须存在且长度 >= 16（杜绝不安全回退签密钥）
 *   - FILE_STORAGE_DRIVER 必须为 cos（生产不得回退本地磁盘存储，合规要求落 COS）
 *   - DATABASE_URL 不得为 file: SQLite（委托 assertRuntimeDatabaseAllowed，与现有
 *     verify:production-db-guard 共用同一判定，避免双份口径漂移）
 *   - SMS_PROVIDER 必须为 tencent，且腾讯短信生产参数齐全（生产不得日志打印验证码）
 *   - OCR_PROVIDER=baidu 时，百度 OCR 生产参数齐全（避免图片/扫描件简历运行时才失败）
 *
 * 非生产环境一律放行：开发 / CI 用本地 SQLite + local 存储 + 测试密钥，不受此门禁约束。
 */
import { assertRuntimeDatabaseAllowed } from '../prisma/create-client'

export interface ProductionRuntimeEnv {
  NODE_ENV?: string
  JWT_SECRET?: string
  FILE_STORAGE_DRIVER?: string
  DATABASE_URL?: string
  SMS_PROVIDER?: string
  TENCENT_SMS_SECRET_ID?: string
  TENCENT_SMS_SECRET_KEY?: string
  TENCENT_SMS_SDK_APP_ID?: string
  TENCENT_SMS_SIGN_NAME?: string
  TENCENT_SMS_TEMPLATE_ID?: string
  OCR_PROVIDER?: string
  BAIDU_OCR_API_KEY?: string
  BAIDU_OCR_SECRET_KEY?: string
}

const MIN_JWT_SECRET_LENGTH = 16
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
  if (ocrProvider === 'baidu' && (!hasValue(env.BAIDU_OCR_API_KEY) || !hasValue(env.BAIDU_OCR_SECRET_KEY))) {
    throw new Error(
      'PRODUCTION_BAIDU_OCR_CONFIG_MISSING: OCR_PROVIDER=baidu 时必须配置 BAIDU_OCR_API_KEY 和 BAIDU_OCR_SECRET_KEY',
    )
  }
}
