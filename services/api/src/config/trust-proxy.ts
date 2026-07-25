/**
 * Express trust proxy 跳数配置（fail-closed）。
 *
 * 生产经 nginx（或同类反代）时必须显式声明 TRUST_PROXY_HOPS=1..9，
 * 由 Express 按可信跳数填充 req.ip；禁止 trust proxy=true（会信任任意
 * X-Forwarded-For）。控制器不得自行解析未受信转发头。
 *
 * 非生产未设置时关闭 trust proxy（返回 false），直连开发不受影响。
 */

export interface TrustProxyEnv {
  NODE_ENV?: string
  TRUST_PROXY_HOPS?: string
}

/** 生产允许的跳数：正整数 1–9（覆盖单层 nginx 到少量前置代理）。 */
const HOPS_PATTERN = /^[1-9]$/

/**
 * 解析 TRUST_PROXY_HOPS。
 * @returns 跳数，或 false 表示不启用 trust proxy
 */
export function resolveTrustProxyHops(
  env: TrustProxyEnv = process.env,
): number | false {
  const raw = env.TRUST_PROXY_HOPS?.trim()
  const isProd = env.NODE_ENV === 'production'

  if (!raw) {
    if (isProd) {
      throw new Error(
        'PRODUCTION_TRUST_PROXY_HOPS_UNDECLARED: NODE_ENV=production 时必须显式设置 TRUST_PROXY_HOPS=1..9（nginx 等反代可信跳数；禁止沉默缺省，禁止 true）',
      )
    }
    return false
  }

  const lower = raw.toLowerCase()
  if (lower === 'true' || lower === 'false') {
    throw new Error(
      'TRUST_PROXY_HOPS_BOOLEAN_FORBIDDEN: TRUST_PROXY_HOPS 必须为 1..9 的跳数，禁止 true/false（true 会信任任意 X-Forwarded-For）',
    )
  }

  if (!HOPS_PATTERN.test(raw)) {
    throw new Error(
      `TRUST_PROXY_HOPS_INVALID: TRUST_PROXY_HOPS 必须为 1..9 的正整数跳数（当前: ${raw}）`,
    )
  }

  return Number(raw)
}

/** 生产启动门禁：强制 TRUST_PROXY_HOPS 已声明且合法。 */
export function assertProductionTrustProxyHops(
  env: TrustProxyEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production') return
  resolveTrustProxyHops(env)
}
