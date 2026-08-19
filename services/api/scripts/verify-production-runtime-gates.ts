import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertProductionRuntimeGates } from '../src/config/production-runtime-gates'
import { resolveJwtSecret } from '../src/common/jwt-verifier.module'

type Env = Parameters<typeof assertProductionRuntimeGates>[0]

const PROD_OK: Env = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-strong-production-secret-0123456789',
  // 2026-08-19 进入集中门禁：此前只在各调用点查长度，而 .env.example 的样值刚好够长。
  FILE_SIGNING_SECRET: 'a-strong-file-signing-secret-0123456789',
  SECRET_ENCRYPTION_KEY: 'a-strong-encryption-key-0123456789ab',
  FILE_STORAGE_DRIVER: 'cos',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/ai_job_print',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  SMS_PROVIDER: 'tencent',
  TENCENT_SMS_SECRET_ID: 'sms-secret-id',
  TENCENT_SMS_SECRET_KEY: 'sms-secret-key',
  TENCENT_SMS_SDK_APP_ID: 'sms-sdk-app-id',
  TENCENT_SMS_SIGN_NAME: 'sms-sign-name',
  TENCENT_SMS_TEMPLATE_ID: 'sms-template-id',
  OCR_PROVIDER: 'baidu',
  BAIDU_OCR_API_KEY: 'baidu-api-key',
  BAIDU_OCR_SECRET_KEY: 'baidu-secret-key',
  AI_PROVIDER: 'llm',
  AI_LLM_API_KEY: 'llm-api-key',
  PAYMENT_SESSION_SECRET: 'payment-session-secret-0123456789',
  // 商用隐私底线：用户原始材料必须完成 PII 检查后才能建打印任务。
  PRINT_REQUIRE_PII_SCAN: 'true',
  // Task 11：生产必须显式声明 print-scan 能力开关未配置行语义
  PRINT_SCAN_CAPABILITY_MODE: 'managed',
  // 反代可信跳数：生产必须显式声明 1..9（禁止 true）
  TRUST_PROXY_HOPS: '1',
  // Gate 0 batch 2：生产必须关闭共享 adminSecret 旧注册面。
  TERMINAL_LEGACY_REGISTER_ENABLED: 'false',
  TERMINAL_PLANNED_PROVISIONING_ENABLED: 'true',
}
const REQUIRED_SMS_KEYS = [
  'TENCENT_SMS_SECRET_ID',
  'TENCENT_SMS_SECRET_KEY',
  'TENCENT_SMS_SDK_APP_ID',
  'TENCENT_SMS_SIGN_NAME',
  'TENCENT_SMS_TEMPLATE_ID',
] as const

function expectAllowed(env: Env, label: string): void {
  assertProductionRuntimeGates(env)
  console.log(`  PASS ${label}`)
}

function expectRejected(env: Env, expectedCode: string, label: string): void {
  try {
    assertProductionRuntimeGates(env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(expectedCode)) {
      throw new Error(`${label}: expected ${expectedCode}, got ${message}`)
    }
    console.log(`  PASS ${label}`)
    return
  }
  throw new Error(`${label}: expected rejection (${expectedCode})`)
}

function expectJwtSecretAllowed(secret: string, label: string): void {
  const prev = process.env['JWT_SECRET']
  process.env['JWT_SECRET'] = secret
  try {
    const resolved = resolveJwtSecret()
    if (resolved !== secret) throw new Error(`${label}: resolved secret mismatch`)
    console.log(`  PASS ${label}`)
  } finally {
    if (prev === undefined) delete process.env['JWT_SECRET']
    else process.env['JWT_SECRET'] = prev
  }
}

function expectJwtSecretRejected(secret: string | undefined, label: string): void {
  const prev = process.env['JWT_SECRET']
  if (secret === undefined) delete process.env['JWT_SECRET']
  else process.env['JWT_SECRET'] = secret
  try {
    resolveJwtSecret()
  } catch {
    console.log(`  PASS ${label}`)
    if (prev === undefined) delete process.env['JWT_SECRET']
    else process.env['JWT_SECRET'] = prev
    return
  }
  if (prev === undefined) delete process.env['JWT_SECRET']
  else process.env['JWT_SECRET'] = prev
  throw new Error(`${label}: expected JWT verifier rejection`)
}

function main(): void {
  console.log('\n=== 生产运行时启动门禁验证 ===')

  // 非生产环境一律放行（即便配置不安全）
  expectAllowed(
    { NODE_ENV: 'development', JWT_SECRET: 'short', FILE_STORAGE_DRIVER: 'local', DATABASE_URL: 'file:./prisma/dev.db' },
    '开发环境放行（不强制生产门禁）',
  )
  expectAllowed(
    { JWT_SECRET: undefined, FILE_STORAGE_DRIVER: undefined, DATABASE_URL: 'file:./prisma/dev.db' },
    '未声明 NODE_ENV 时放行',
  )

  // 运行时 JwtModule 验签配置必须始终 fail-closed；不依赖 NODE_ENV。
  expectJwtSecretRejected(undefined, 'JwtVerifierModule 拒绝缺失 JWT_SECRET')
  expectJwtSecretRejected('too-short', 'JwtVerifierModule 拒绝过短 JWT_SECRET')
  expectJwtSecretAllowed('runtime-jwt-secret-0123456789', 'JwtVerifierModule 接受强 JWT_SECRET')

  // 生产环境：全部满足时放行
  expectAllowed(PROD_OK, '生产环境合规配置放行')

  // 生产环境：JWT_SECRET 门禁
  expectRejected(
    { ...PROD_OK, JWT_SECRET: undefined },
    'PRODUCTION_JWT_SECRET_INVALID',
    '生产环境拒绝缺失 JWT_SECRET',
  )
  expectRejected(
    { ...PROD_OK, JWT_SECRET: 'too-short' },
    'PRODUCTION_JWT_SECRET_INVALID',
    '生产环境拒绝过短 JWT_SECRET（<16）',
  )

  // 生产环境：FILE_STORAGE_DRIVER 门禁
  expectRejected(
    { ...PROD_OK, FILE_STORAGE_DRIVER: 'local' },
    'PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS',
    '生产环境拒绝 FILE_STORAGE_DRIVER=local',
  )
  expectRejected(
    { ...PROD_OK, FILE_STORAGE_DRIVER: undefined },
    'PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS',
    '生产环境拒绝未设置 FILE_STORAGE_DRIVER',
  )

  // 生产环境：DATABASE_URL 门禁（委托 assertRuntimeDatabaseAllowed）
  expectRejected(
    { ...PROD_OK, DATABASE_URL: undefined },
    'PRODUCTION_DATABASE_URL_MISSING',
    '生产环境拒绝缺失 DATABASE_URL',
  )
  expectRejected(
    { ...PROD_OK, DATABASE_URL: 'file:./prisma/dev.db' },
    'PRODUCTION_SQLITE_FORBIDDEN',
    '生产环境拒绝 SQLite 数据库',
  )

  // 生产环境：Redis 必须配置，保障会员会话、队列、幂等和防重放能力
  expectRejected(
    { ...PROD_OK, REDIS_URL: undefined },
    'PRODUCTION_REDIS_URL_MISSING',
    '生产环境拒绝缺失 REDIS_URL',
  )

  // 生产环境：短信必须使用腾讯云真实 provider，且必填项齐全
  expectRejected(
    { ...PROD_OK, SMS_PROVIDER: undefined },
    'PRODUCTION_SMS_PROVIDER_NOT_TENCENT',
    '生产环境拒绝未设置 SMS_PROVIDER',
  )
  expectRejected(
    { ...PROD_OK, SMS_PROVIDER: 'log' },
    'PRODUCTION_SMS_PROVIDER_NOT_TENCENT',
    '生产环境拒绝 SMS_PROVIDER=log',
  )
  for (const key of REQUIRED_SMS_KEYS) {
    expectRejected(
      { ...PROD_OK, [key]: key.endsWith('KEY') ? '   ' : '' },
      'PRODUCTION_TENCENT_SMS_CONFIG_MISSING',
      `生产环境拒绝腾讯短信配置缺项:${key}`,
    )
  }

  // 生产环境：OCR 必须接百度真实服务，且必须填齐百度密钥
  expectRejected(
    { ...PROD_OK, OCR_PROVIDER: undefined },
    'PRODUCTION_OCR_PROVIDER_NOT_BAIDU',
    '生产环境拒绝未设置 OCR_PROVIDER',
  )
  expectRejected(
    { ...PROD_OK, OCR_PROVIDER: 'disabled' },
    'PRODUCTION_OCR_PROVIDER_NOT_BAIDU',
    '生产环境拒绝 OCR_PROVIDER=disabled',
  )
  expectRejected(
    { ...PROD_OK, BAIDU_OCR_API_KEY: '   ' },
    'PRODUCTION_BAIDU_OCR_CONFIG_MISSING',
    '生产环境拒绝百度 OCR 缺失 API Key',
  )
  expectRejected(
    { ...PROD_OK, BAIDU_OCR_SECRET_KEY: undefined },
    'PRODUCTION_BAIDU_OCR_CONFIG_MISSING',
    '生产环境拒绝百度 OCR 缺失密钥',
  )
  // 生产环境：AI 必须走真实 LLM adapter，不能回退 mock 或未闭环 stub
  expectRejected(
    { ...PROD_OK, AI_PROVIDER: undefined },
    'PRODUCTION_AI_PROVIDER_NOT_LLM',
    '生产环境拒绝未设置 AI_PROVIDER',
  )
  expectRejected(
    { ...PROD_OK, AI_PROVIDER: 'mock' },
    'PRODUCTION_AI_PROVIDER_NOT_LLM',
    '生产环境拒绝 AI_PROVIDER=mock',
  )
  expectRejected(
    { ...PROD_OK, AI_PROVIDER: 'openai' },
    'PRODUCTION_AI_PROVIDER_NOT_LLM',
    '生产环境拒绝未闭环 AI provider stub',
  )
  expectRejected(
    { ...PROD_OK, AI_LLM_API_KEY: '   ', TRTC_LLM_API_KEY: undefined },
    'PRODUCTION_LLM_CONFIG_MISSING',
    '生产环境拒绝缺失真实 LLM 密钥',
  )
  expectAllowed(
    { ...PROD_OK, AI_LLM_API_KEY: undefined, TRTC_LLM_API_KEY: 'trtc-llm-api-key' },
    '生产环境允许 TRTC_LLM_API_KEY 作为 LLM 密钥兼容项',
  )

  // 生产环境：短期支付会话签名密钥必须独立配置，不能回退 JWT / 文件签名密钥
  expectRejected(
    { ...PROD_OK, PAYMENT_SESSION_SECRET: undefined },
    'PRODUCTION_PAYMENT_SESSION_SECRET_INVALID',
    '生产环境拒绝缺失 PAYMENT_SESSION_SECRET',
  )
  expectRejected(
    { ...PROD_OK, PAYMENT_SESSION_SECRET: 'too-short' },
    'PRODUCTION_PAYMENT_SESSION_SECRET_INVALID',
    '生产环境拒绝过短 PAYMENT_SESSION_SECRET（<32）',
  )

  // 生产环境：支付通道门禁（C5-2 沙箱禁产 + C5-6 真实通道）
  expectRejected(
    { ...PROD_OK, PAYMENT_PROVIDER: 'sandbox' },
    'PRODUCTION_PAYMENT_PROVIDER_SANDBOX_FORBIDDEN',
    '生产环境拒绝 PAYMENT_PROVIDER=sandbox',
  )
  expectRejected(
    { ...PROD_OK, PAYMENT_PROVIDER: 'wechat,sandbox' },
    'PRODUCTION_PAYMENT_PROVIDER_SANDBOX_FORBIDDEN',
    '生产环境拒绝逗号列表中混入 sandbox',
  )
  expectAllowed(
    { ...PROD_OK, PAYMENT_PROVIDER: 'wechat,alipay' },
    '生产环境允许 wechat,alipay 真实通道（凭证齐全性由 Provider 工厂另行 fail-closed 校验）',
  )

  // 先付后印不再是部署开关：claim 无条件只领 payStatus='paid'，写死在
  // terminals-agent.service.ts 的 claimableWhere 里。这里只需证明启动门禁
  // 不再因为该变量的取值而放行或拒绝 —— 它已经不参与任何决策。
  //
  // 被删掉的用例里最危险的一条是「生产 + PAYMENT_PROVIDER=disabled +
  // PRINT_REQUIRE_PAID_BEFORE_CLAIM=false 允许启动」：它把「未支付可出纸」
  // 写成了合法部署形态。删除它不是放宽防线，因为对应的代码路径已经不存在。
  expectAllowed(
    { ...PROD_OK, PRINT_REQUIRE_PAID_BEFORE_CLAIM: 'false' },
    '旧的 paid-before-claim 变量已不参与启动决策（取 false 也不影响启动，且不再有可关闭的出纸门控）',
  )
  expectAllowed(
    { ...PROD_OK, PRINT_REQUIRE_PAID_BEFORE_CLAIM: undefined },
    '不再要求声明 paid-before-claim（开关已删除）',
  )

  // 生产环境：打印前 PII 检查必须显式开启，不能保留观察期 bypass。
  expectRejected(
    { ...PROD_OK, PRINT_REQUIRE_PII_SCAN: undefined },
    'PRODUCTION_PRINT_PII_SCAN_REQUIRED',
    '生产环境拒绝未设置 PRINT_REQUIRE_PII_SCAN',
  )
  expectRejected(
    { ...PROD_OK, PRINT_REQUIRE_PII_SCAN: 'false' },
    'PRODUCTION_PRINT_PII_SCAN_REQUIRED',
    '生产环境拒绝关闭 PRINT_REQUIRE_PII_SCAN',
  )
  expectRejected(
    { ...PROD_OK, PRINT_REQUIRE_PII_SCAN: 'yes' },
    'PRODUCTION_PRINT_PII_SCAN_REQUIRED',
    '生产环境拒绝 PRINT_REQUIRE_PII_SCAN 非 true 取值',
  )
  expectRejected(
    { ...PROD_OK, PRINT_REQUIRE_PII_SCAN: 'TRUE' },
    'PRODUCTION_PRINT_PII_SCAN_REQUIRED',
    '生产环境拒绝大小写变体，保持与运行时精确判定一致',
  )
  expectRejected(
    { ...PROD_OK, PRINT_REQUIRE_PII_SCAN: ' true ' },
    'PRODUCTION_PRINT_PII_SCAN_REQUIRED',
    '生产环境拒绝空格变体，避免启动门禁与建单门禁漂移',
  )

  // Task 11：print-scan feature gate 显式声明
  expectRejected(
    { ...PROD_OK, PRINT_SCAN_CAPABILITY_MODE: undefined },
    'PRODUCTION_PRINT_SCAN_CAPABILITY_MODE_UNDECLARED',
    '生产环境拒绝未显式声明 PRINT_SCAN_CAPABILITY_MODE（print-scan feature gate 配置缺失即拒启动）',
  )
  expectRejected(
    { ...PROD_OK, PRINT_SCAN_CAPABILITY_MODE: 'enabled' },
    'PRODUCTION_PRINT_SCAN_CAPABILITY_MODE_UNDECLARED',
    '生产环境拒绝枚举外的 PRINT_SCAN_CAPABILITY_MODE 取值',
  )
  expectAllowed(
    { ...PROD_OK, PRINT_SCAN_CAPABILITY_MODE: 'strict' },
    '生产环境允许显式声明 strict（未配置能力行 fail-closed）',
  )

  // TRUST_PROXY_HOPS：生产必须显式跳数，禁止 true/false
  expectRejected(
    { ...PROD_OK, TRUST_PROXY_HOPS: undefined },
    'PRODUCTION_TRUST_PROXY_HOPS_UNDECLARED',
    '生产环境拒绝未显式声明 TRUST_PROXY_HOPS',
  )
  expectRejected(
    { ...PROD_OK, TRUST_PROXY_HOPS: 'true' },
    'TRUST_PROXY_HOPS_BOOLEAN_FORBIDDEN',
    '生产环境拒绝 TRUST_PROXY_HOPS=true（会信任任意 X-Forwarded-For）',
  )
  expectRejected(
    { ...PROD_OK, TRUST_PROXY_HOPS: '0' },
    'TRUST_PROXY_HOPS_INVALID',
    '生产环境拒绝非法跳数 0',
  )
  expectAllowed(
    { ...PROD_OK, TRUST_PROXY_HOPS: '2' },
    '生产环境允许显式声明 hops=2',
  )

  expectRejected(
    { ...PROD_OK, TERMINAL_LEGACY_REGISTER_ENABLED: undefined },
    'PRODUCTION_TERMINAL_LEGACY_REGISTER_FORBIDDEN',
    '生产环境拒绝未显式关闭 Terminal 共享密钥旧注册',
  )
  expectRejected(
    { ...PROD_OK, TERMINAL_LEGACY_REGISTER_ENABLED: 'true' },
    'PRODUCTION_TERMINAL_LEGACY_REGISTER_FORBIDDEN',
    '生产环境拒绝开启 Terminal 共享密钥旧注册',
  )
  expectRejected(
    { ...PROD_OK, TERMINAL_PLANNED_PROVISIONING_ENABLED: undefined },
    'PRODUCTION_TERMINAL_PLANNED_PROVISIONING_UNDECLARED',
    '生产环境拒绝未显式声明 planned writer 状态',
  )
  expectAllowed(
    { ...PROD_OK, TERMINAL_PLANNED_PROVISIONING_ENABLED: 'false' },
    '生产滚动部署第一阶段允许显式关闭 planned writer',
  )
  expectAllowed(
    { ...PROD_OK, TERMINAL_PLANNED_PROVISIONING_ENABLED: 'true' },
    '生产全实例升级后允许显式开启 planned writer',
  )

  // ── 照抄 .env.example 必须起不了生产（2026-08-19）────────────────────────
  //
  // 弱默认的危险不在「值不好」，在于**它们能跑**：示例里的密钥刻意做得够长，
  // 于是所有长度校验一律放行，运维照抄就能起一个用公开在仓库里的密钥签 JWT、
  // 做手机号 pepper 的生产实例。
  //
  // 覆盖名单仍是手写的（漏列就不会查），但样值本身从 .env.example 现场解析，
  // 不把「dev-xxx」字符串再抄一份到本文件。漏列的键合入前必须补进名单。
  const exampleText = readFileSync(join(__dirname, '..', '.env.example'), 'utf8')
  const exampleValues = new Map<string, string>()
  for (const line of exampleText.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (!m) continue
    const value = (m[2] ?? '').trim().replace(/^["']|["']$/g, '')
    if (value) exampleValues.set(m[1] as string, value)
  }
  if (exampleValues.size === 0) throw new Error('解析 .env.example 得到 0 个键，格式可能已变')

  // 只针对门禁真正覆盖的敏感键做断言；其余键（端口、区域、开关）不在此列。
  const GUARDED_SECRET_KEYS = [
    'JWT_SECRET',
    'FILE_SIGNING_SECRET',
    'SECRET_ENCRYPTION_KEY',
    'PAYMENT_SESSION_SECRET',
  ] as const
  let checked = 0
  for (const key of GUARDED_SECRET_KEYS) {
    const sample = exampleValues.get(key)
    if (!sample) {
      throw new Error(`.env.example 缺少 ${key} 的可跑样值 —— 本节靠它证明样值会被拒`)
    }
    expectRejected(
      { ...PROD_OK, [key]: sample } as Env,
      'PRODUCTION_SAMPLE_SECRET_FORBIDDEN',
      `生产拒绝 .env.example 的 ${key} 样值`,
    )
    checked += 1
  }
  console.log(`  PASS 已对 ${checked} 个敏感键逐一证明「照抄示例起不了生产」`)

  // 示例文件不得再出现真实生产资源标识（原先写着真实 COS 桶名）。
  const bucket = exampleValues.get('TENCENT_COS_BUCKET')
  if (bucket) {
    throw new Error(`.env.example 的 TENCENT_COS_BUCKET 必须留空，当前为「${bucket}」——不得泄露生产资源标识`)
  }
  console.log('  PASS .env.example 未写入真实 COS 桶名')

  console.log('\n=== ALL PASS ===')
}

main()
