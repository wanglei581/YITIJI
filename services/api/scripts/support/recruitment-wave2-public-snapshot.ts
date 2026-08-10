import { createHash } from 'node:crypto'
import { resolve4, resolve6 } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import type { RecruitmentWave2TargetConfig } from '../../src/recruitment-content/recruitment-wave2-target'
import { assertRecruitmentWave2ExecutionWindow } from '../../src/recruitment-content/recruitment-wave2-target'

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REQUESTS = 20_000
const MAX_ITEMS = 50_000

export interface RecruitmentPublicEnvironment {
  RECRUITMENT_WAVE2_PUBLIC_API_BASE_URL?: string
  RECRUITMENT_WAVE2_EXPECTED_PUBLIC_API_ORIGIN?: string
  RECRUITMENT_WAVE2_EXPECTED_EXCLUDE_DEMO_PUBLIC_DATA?: string
}

export interface RecruitmentPublicTarget {
  baseUrl: URL
  origin: string
  originDigest: string
  excludeDemoFairData: boolean
  pinnedAddress: string
  pinnedFamily: 4 | 6
}

export type PublicEntity = 'jobs' | 'jobFairs' | 'policies' | 'offlineAgencies' | 'offlineJobs'
export type PublicIdSets = Record<PublicEntity, string[]>

export interface PublicSnapshot {
  ids: PublicIdSets
  digests: Record<PublicEntity, string>
  snapshotDigest: string
  requestCount: number
}

type RequestJson = (path: string) => Promise<unknown>

export async function resolveRecruitmentPublicTarget(
  config: RecruitmentWave2TargetConfig,
  env: RecruitmentPublicEnvironment = process.env
): Promise<RecruitmentPublicTarget> {
  const raw = env.RECRUITMENT_WAVE2_PUBLIC_API_BASE_URL
  const expected = env.RECRUITMENT_WAVE2_EXPECTED_PUBLIC_API_ORIGIN
  if (!raw || !expected) throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_TARGET_REQUIRED')
  let base: URL
  let expectedOrigin: URL
  try {
    base = new URL(raw)
    expectedOrigin = new URL(expected)
  } catch {
    throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_TARGET_INVALID')
  }
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/api/v1' ||
    expectedOrigin.username ||
    expectedOrigin.password ||
    expectedOrigin.search ||
    expectedOrigin.hash ||
    expectedOrigin.pathname !== '/'
  ) {
    throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_TARGET_INVALID')
  }
  if (base.origin !== expectedOrigin.origin)
    throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_ORIGIN_MISMATCH')
  const demo = env.RECRUITMENT_WAVE2_EXPECTED_EXCLUDE_DEMO_PUBLIC_DATA
  if (demo !== 'true' && demo !== 'false')
    throw new Error('RECRUITMENT_WAVE2_FAIR_VISIBILITY_POLICY_REQUIRED')
  const ci = config.target === 'ci-fixture'
  if (ci) {
    if (base.protocol !== 'http:' || !isLoopbackHost(base.hostname)) {
      throw new Error('RECRUITMENT_WAVE2_CI_PUBLIC_API_NOT_LOOPBACK')
    }
    return target(base, demo === 'true', base.hostname === '::1' ? '::1' : '127.0.0.1')
  }
  if (
    config.target !== 'authorized-readonly' ||
    base.protocol !== 'https:' ||
    (base.port && base.port !== '443') ||
    isIP(base.hostname) ||
    base.hostname.endsWith('.local')
  ) {
    throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_TARGET_UNSAFE')
  }
  const addresses = await resolvePublicAddresses(base.hostname)
  return target(base, demo === 'true', addresses[0]!)
}

function target(base: URL, excludeDemoFairData: boolean, address: string): RecruitmentPublicTarget {
  return {
    baseUrl: base,
    origin: base.origin,
    originDigest: sha256(base.origin),
    excludeDemoFairData,
    pinnedAddress: address,
    pinnedFamily: isIP(address) as 4 | 6,
  }
}

export async function collectPublicSnapshot(
  targetConfig: RecruitmentWave2TargetConfig,
  publicTarget: RecruitmentPublicTarget,
  requestJson: RequestJson = createPinnedJsonRequester(targetConfig, publicTarget)
): Promise<PublicSnapshot> {
  let requestCount = 0
  const request = async (path: string) => {
    assertRecruitmentWave2ExecutionWindow(targetConfig)
    if (++requestCount > MAX_REQUESTS) throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_REQUEST_LIMIT')
    return requestJson(path)
  }
  await assertHealth(await request('/health'))
  const jobs = await collectPagination(request, '/jobs', 'pagination', 100)
  const jobFairs = await collectPagination(request, '/job-fairs', 'pagination', 100)
  const policies = await collectPagination(request, '/policies', 'pagination', 200)
  const offlineAgencies = await collectPagination(request, '/kiosk/offline-agencies', 'legacy', 100)
  const offlineJobs: string[] = []
  for (const agencyId of offlineAgencies) {
    offlineJobs.push(
      ...(await collectPagination(
        request,
        `/kiosk/offline-agencies/${encodeURIComponent(agencyId)}/jobs`,
        'legacy',
        100
      ))
    )
    if (offlineJobs.length > MAX_ITEMS)
      throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_ITEM_LIMIT')
  }
  const ids = normalizeSets({ jobs, jobFairs, policies, offlineAgencies, offlineJobs })
  const digests = mapDigests(ids)
  return { ids, digests, snapshotDigest: sha256(JSON.stringify(digests)), requestCount }
}

export async function verifyPublicTargetHealth(
  targetConfig: RecruitmentWave2TargetConfig,
  publicTarget: RecruitmentPublicTarget
): Promise<void> {
  assertRecruitmentWave2ExecutionWindow(targetConfig)
  await assertHealth(await createPinnedJsonRequester(targetConfig, publicTarget)('/health'))
}

export function comparePublicSnapshots(first: PublicSnapshot, second: PublicSnapshot): void {
  if (first.snapshotDigest !== second.snapshotDigest)
    throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_SNAPSHOT_DRIFT')
}

export function diffIdSets(expected: PublicIdSets, actual: PublicIdSets) {
  return Object.fromEntries(
    (Object.keys(expected) as PublicEntity[]).map((entity) => {
      const expectedSet = new Set(expected[entity])
      const actualSet = new Set(actual[entity])
      return [
        entity,
        {
          missingFromApi: [...expectedSet].filter((id) => !actualSet.has(id)).sort(),
          unexpectedInApi: [...actualSet].filter((id) => !expectedSet.has(id)).sort(),
        },
      ]
    })
  ) as Record<PublicEntity, { missingFromApi: string[]; unexpectedInApi: string[] }>
}

async function collectPagination(
  request: (path: string) => Promise<unknown>,
  pathname: string,
  envelope: 'pagination' | 'legacy',
  pageSize: number
): Promise<string[]> {
  const ids: string[] = []
  let expectedTotal: number | null = null
  for (let page = 1; page <= 10_000; page++) {
    const value = asObject(await request(`${pathname}?page=${page}&pageSize=${pageSize}`))
    const data = value['data']
    if (!Array.isArray(data)) throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_SCHEMA_INVALID')
    const meta = envelope === 'pagination' ? asObject(value['pagination']) : value
    const total = safeInteger(meta['total'])
    const returnedPage = safeInteger(meta['page'])
    const returnedPageSize = safeInteger(meta['pageSize'])
    if (
      total === null ||
      returnedPage !== page ||
      returnedPageSize !== pageSize ||
      total > MAX_ITEMS
    ) {
      throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_PAGINATION_INVALID')
    }
    if (
      envelope === 'pagination' &&
      safeInteger(meta['totalPages']) !== Math.max(1, Math.ceil(total / pageSize))
    ) {
      throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_PAGINATION_INVALID')
    }
    expectedTotal ??= total
    if (expectedTotal !== total) throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_PAGINATION_DRIFT')
    for (const item of data) ids.push(requireId(item))
    if (ids.length > total || new Set(ids).size !== ids.length) {
      throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_DUPLICATE_ID')
    }
    if (ids.length === total) return ids
    if (data.length !== pageSize)
      throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_PAGINATION_INCOMPLETE')
  }
  throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_PAGE_LIMIT')
}

function createPinnedJsonRequester(
  config: RecruitmentWave2TargetConfig,
  targetConfig: RecruitmentPublicTarget
): RequestJson {
  return async (path) => {
    const url = new URL(`${targetConfig.baseUrl.pathname}${path}`, targetConfig.origin)
    if (url.origin !== targetConfig.origin)
      throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_ORIGIN_MISMATCH')
    return new Promise((resolve, reject) => {
      const requester = url.protocol === 'https:' ? httpsRequest : httpRequest
      const req = requester(
        url,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'accept-encoding': 'identity',
            'cache-control': 'no-cache',
            'user-agent': 'recruitment-wave2-readonly-inventory/1',
          },
          lookup: (_hostname, options, callback) => {
            if (typeof options === 'object' && options.all) {
              ;(callback as unknown as (
                error: null,
                addresses: Array<{ address: string; family: number }>
              ) => void)(null, [{ address: targetConfig.pinnedAddress, family: targetConfig.pinnedFamily }])
              return
            }
            ;(callback as unknown as (error: null, address: string, family: number) => void)(
              null,
              targetConfig.pinnedAddress,
              targetConfig.pinnedFamily
            )
          },
          servername: url.protocol === 'https:' ? targetConfig.baseUrl.hostname : undefined,
          timeout: 10_000,
        },
        (res) => {
          if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
            res.destroy()
            reject(new Error('RECRUITMENT_WAVE2_PUBLIC_API_REDIRECT_FORBIDDEN'))
            return
          }
          if (res.statusCode !== 200) {
            res.destroy()
            reject(new Error('RECRUITMENT_WAVE2_PUBLIC_API_HTTP_STATUS'))
            return
          }
          const contentType = String(res.headers['content-type'] ?? '')
          if (!/^application\/json(?:;|$)/iu.test(contentType)) {
            res.destroy()
            reject(new Error('RECRUITMENT_WAVE2_PUBLIC_API_CONTENT_TYPE'))
            return
          }
          const encoding = String(res.headers['content-encoding'] ?? 'identity').toLowerCase()
          if (encoding !== 'identity') {
            res.destroy()
            reject(new Error('RECRUITMENT_WAVE2_PUBLIC_API_ENCODING_FORBIDDEN'))
            return
          }
          let size = 0
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > MAX_BODY_BYTES)
              res.destroy(new Error('RECRUITMENT_WAVE2_PUBLIC_API_BODY_LIMIT'))
            else chunks.push(chunk)
          })
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
            } catch {
              reject(new Error('RECRUITMENT_WAVE2_PUBLIC_API_JSON_INVALID'))
            }
          })
          res.on('error', reject)
        }
      )
      const totalTimer = setTimeout(
        () => req.destroy(new Error('RECRUITMENT_WAVE2_PUBLIC_API_TOTAL_TIMEOUT')),
        15_000
      )
      req.on('close', () => clearTimeout(totalTimer))
      req.on('timeout', () => req.destroy(new Error('RECRUITMENT_WAVE2_PUBLIC_API_TIMEOUT')))
      req.on('error', (error) => reject(safeNetworkError(error)))
      assertRecruitmentWave2ExecutionWindow(config)
      req.end()
    })
  }
}

async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  const [v4, v6] = await Promise.allSettled([resolve4(hostname), resolve6(hostname)])
  const addresses = [
    ...(v4.status === 'fulfilled' ? v4.value : []),
    ...(v6.status === 'fulfilled' ? v6.value : []),
  ]
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_DNS_UNSAFE')
  }
  return addresses.sort()
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized.startsWith('64:ff9b::') || normalized.startsWith('64:ff9b:1:')) return false
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (isIP(address) === 6) {
    if (hasEmbeddedIpv4(address)) return false
    const value = address.toLowerCase()
    return !(
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      /^fe[89ab]/u.test(value) ||
      value.startsWith('ff') ||
      value.startsWith('2001:db8')
    )
  }
  return false
}

function hasEmbeddedIpv4(address: string): boolean {
  const hextets = expandIpv6(address)
  if (!hextets) return false
  const compatible = hextets.slice(0, 6).every((value) => value === 0)
  const mapped = hextets.slice(0, 5).every((value) => value === 0) && hextets[5] === 0xffff
  return compatible || mapped
}

function expandIpv6(address: string): number[] | null {
  let value = address.toLowerCase()
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/u)?.[1]
  if (dotted) {
    const octets = dotted.split('.').map(Number)
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet > 255))
      return null
    value = `${value.slice(0, -dotted.length)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`
  }
  const halves = value.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null
  const words = [...left, ...Array<string>(missing).fill('0'), ...right].map((word) =>
    Number.parseInt(word, 16)
  )
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word <= 0xffff)
    ? words
    : null
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function normalizeSets(value: PublicIdSets): PublicIdSets {
  for (const key of Object.keys(value) as PublicEntity[]) {
    value[key] = [...value[key]].sort()
    if (new Set(value[key]).size !== value[key].length)
      throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_DUPLICATE_ID')
  }
  return value
}

function mapDigests(ids: PublicIdSets): Record<PublicEntity, string> {
  return Object.fromEntries(
    (Object.keys(ids) as PublicEntity[]).map((key) => [key, sha256(ids[key].join('\n'))])
  ) as never
}

function requireId(value: unknown): string {
  const id = asObject(value)['id']
  if (typeof id !== 'string' || !SAFE_ID.test(id))
    throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_ID_INVALID')
  return id
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_SCHEMA_INVALID')
  return value as Record<string, unknown>
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

async function assertHealth(value: unknown): Promise<void> {
  const body = asObject(value)
  const data = asObject(body['data'])
  if (body['success'] !== true || data['status'] !== 'ok' || data['db'] !== 'postgres') {
    throw new Error('RECRUITMENT_WAVE2_PUBLIC_API_HEALTH_INVALID')
  }
}

function safeNetworkError(error: unknown): Error {
  const message = error instanceof Error ? error.message : ''
  return /^RECRUITMENT_WAVE2_[A-Z0-9_]+$/u.test(message)
    ? new Error(message)
    : new Error('RECRUITMENT_WAVE2_PUBLIC_API_NETWORK_FAILED')
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
