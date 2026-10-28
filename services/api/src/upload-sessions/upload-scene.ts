/**
 * 扫码上传的「小程序场景码」。
 *
 * 为什么需要它：一体机的扫码上传二维码原先编的是**网页地址**，里面直接带着
 * sessionId 和 uploadToken。产品负责人 2026-09-08 要求「微信扫码直接打开小程序，
 * 而不是一个网页」——小程序是主入口，网页是第三个入口，会把用户踢出去、还丢掉
 * 小程序里的登录态。
 *
 * 但微信 `getwxacodeunlimit` 的 scene 最长 **32 个可见字符**，塞不下
 * 「sessionId + uploadToken」。所以扫码带的只能是一个短的不透明凭据，
 * 由服务端换回会话。
 *
 * 三条约束决定了这里的形状：
 *
 * ① **只存哈希。** 会话记录一直是只存 uploadTokenHash / controlTokenHash，
 *    明文令牌只在创建时返回一次。场景码沿用同一条铁律 —— 落 Redis 的是
 *    sha256，拿到 Redis 读权限也换不回可用凭据。
 *
 * ② **会话有效期内可重复兑换，令牌确定性派生。** 同一张码每次兑换都拿到同一把
 *    uploadToken = base64url(HMAC-SHA256(FILE_SIGNING_SECRET,
 *    'upload-scene-token:v1:' + sessionId + ':' + scene))。原因：同一张码可能先被网页
 *    兑换、再被小程序兑换，或同一人重扫，一次性兑换会让码当场变死码；线上网页码本来就
 *    把 uploadToken 明文放在码里，可重复兑换并不降低安全等级。派生而不是存明文，①不变：
 *    服务端仍只存令牌的 sha256。第一次兑换把会话令牌换成派生令牌，create 时发给一体机的
 *    那把随之作废；会话一旦不是 pending（已收到文件 / 过期 / 作废），码就换不到东西了。
 *
 * ③ **字符集必须过微信那一关。** base64url 只含 `A-Za-z0-9-_`，
 *    落在 miniapp-code 的 SCENE_PATTERN 里；18 字节 → 24 字符，
 *    既有 144 位熵，又留了余量不贴着 32 的上限。
 */
import { BadRequestException } from '@nestjs/common'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import type { MemberBindHost, StoredUploadSession } from './upload-session-member-bind'

/** Redis 索引键前缀。键里放的是 sha256(scene)，不是 scene 本身。 */
const SCENE_INDEX_PREFIX = 'upload_session_scene:'

/** 18 字节 base64url = 24 字符，未达微信 32 上限。 */
const SCENE_BYTES = 18

/**
 * 微信 scene 允许的字符集（与 miniapp-code.service 的 SCENE_PATTERN 同源）。
 * 这里收得更紧：只认我们自己签发的 base64url，不认微信允许的全部标点 ——
 * 兑换入口是公开的，宽松的字符集只会放大探测面。
 */
const SCENE_PATTERN = /^[A-Za-z0-9_-]{16,32}$/

export function mintSceneToken(): string {
  return randomBytes(SCENE_BYTES).toString('base64url')
}

/** 格式不对的一律不查 Redis —— 省一次往返，也不给探测者反馈时间差。 */
export function isWellFormedSceneToken(scene: unknown): scene is string {
  return typeof scene === 'string' && SCENE_PATTERN.test(scene)
}

export function sceneIndexKey(scene: string): string {
  return `${SCENE_INDEX_PREFIX}${createHash('sha256').update(scene).digest('hex')}`
}

/** 派生上传令牌的命名空间：与同一把密钥的文件签名等用途隔开，一个 HMAC 不能跨用途复用。 */
const SCENE_UPLOAD_TOKEN_NAMESPACE = 'upload-scene-token:v1:'

/** 兑换场景码拿到的上传令牌（见文件头②）。同一会话、同一张码，永远是同一把。 */
export function deriveSceneUploadToken(sessionId: string, scene: string): string {
  return createHmac('sha256', sceneTokenSecret())
    .update(`${SCENE_UPLOAD_TOKEN_NAMESPACE}${sessionId}:${scene}`)
    .digest('base64url')
}

/** 与 files/signing.ts 同一把密钥、同一口径：取不到就报错，绝不回落成固定值。 */
function sceneTokenSecret(): string {
  const secret = process.env['FILE_SIGNING_SECRET']
  if (!secret || secret.length < 32) {
    throw new Error('FILE_SIGNING_SECRET environment variable must be set (≥ 32 chars)')
  }
  return secret
}

/** 第一次兑换要写会话时拿上传锁的有界重试：总共约 2 秒，每次间隔 100–200ms。 */
const SCENE_LOCK_RETRY_TOTAL_MS = 2_000
const SCENE_LOCK_RETRY_BASE_MS = 100
const SCENE_LOCK_RETRY_JITTER_MS = 100

export interface SceneRedemption {
  sessionId: string
  purpose: StoredUploadSession['purpose']
  mode: StoredUploadSession['mode']
  expiresAt: string
  /** 派生令牌（见文件头②）。 */
  uploadToken: string
}

/**
 * 场景码兑换：小程序扫码进来后，用 scene 换回可用的上传凭据（规则见文件头②）。
 *
 * 一、只读快路径：不加锁先读会话，pending、场景码哈希对得上、令牌哈希已是派生令牌（之前兑换过）
 *    就不用写，直接回令牌 —— 重扫、网页和小程序先后兑换都走这里，不跟正在进行的上传抢锁。
 * 二、要写（第一次兑换）：拿上传锁有界重试；拿到后锁内重读、按条件写回。锁内重读是为了不用
 *    pending 快照盖掉刚落成的 uploaded 收据。
 * 三、重试用尽仍拿不到锁：再走一次快路径（可能别人刚兑换完），还不行才判失效。
 *
 * 所有失败对外是同一个 UPLOAD_SCENE_UNUSABLE。区分「格式不对 / 没这张码 / 已过期 / 已收到文件
 * 或已作废 / 一直抢不到锁」对合法用户没有价值（补救动作都是回一体机刷新二维码），对探测者却是
 * 一台预言机。
 */
export async function redeemScene(host: MemberBindHost, scene: string): Promise<SceneRedemption> {
  // 格式不对就不查 Redis：省一次往返，也不制造可测量的时间差。
  if (!isWellFormedSceneToken(scene)) throw sceneUnusableException()
  // 索引不删：它与会话同 TTL、随会话自然到期，可重复兑换靠的就是它一直在。
  const sessionId = await host.redis.get(sceneIndexKey(scene))
  if (!sessionId) throw sceneUnusableException()
  const uploadToken = deriveSceneUploadToken(sessionId, scene)
  const uploadTokenHash = hashToken(uploadToken)
  const settled = await alreadyRedeemed(host, sessionId, scene, uploadTokenHash)
  if (settled) return redemption(settled, uploadToken)

  const lockKey = host.uploadLockKey(sessionId)
  const lockToken = randomUUID()
  if (!(await acquireWithRetry(() => host.redis.setNxEx(lockKey, lockToken, host.lockTtlSeconds)))) {
    const later = await alreadyRedeemed(host, sessionId, scene, uploadTokenHash)
    if (later) return redemption(later, uploadToken)
    throw sceneUnusableException()
  }
  try {
    const stored = await host.loadOptional(sessionId)
    const record = stored ? host.markExpired(stored) : null
    if (!record || !sceneMatches(record, scene)) throw sceneUnusableException()
    // 第一次兑换把会话令牌换成派生令牌，create 发给一体机的那把随之作废（一体机自己从不用它
    // 上传）；哈希已经相等（别人刚兑换过）就不写。服务端仍只存哈希（文件头①）。
    if (!safeEquals(record.uploadTokenHash, uploadTokenHash)) {
      const committed = await host.commitSession({ ...record, uploadTokenHash }, lockKey, lockToken, 'pending')
      if (committed !== 'updated') throw sceneUnusableException()
    }
    return redemption(record, uploadToken)
  } finally {
    await host.redis.getAndDelIfEquals(lockKey, lockToken).catch(() => undefined)
  }
}

/**
 * 会话还在等文件，且场景码哈希对得上。纵深防御：索引命中还不够，会话记录里的哈希也必须相等；
 * 旧构建创建的会话没有 sceneTokenHash —— 缺失即不认，不是「随便什么 scene 都行」。
 */
function sceneMatches(record: StoredUploadSession, scene: string): boolean {
  return record.status === 'pending'
    && Boolean(record.sceneTokenHash)
    && safeEquals(record.sceneTokenHash ?? '', hashToken(scene))
}

/** 只读快路径：不加锁，令牌哈希已是派生令牌才算数；否则回 null，交给加锁路径。 */
async function alreadyRedeemed(
  host: MemberBindHost,
  sessionId: string,
  scene: string,
  uploadTokenHash: string,
): Promise<StoredUploadSession | null> {
  const stored = await host.loadOptional(sessionId)
  const record = stored ? host.markExpired(stored) : null
  if (!record || !sceneMatches(record, scene)) return null
  return safeEquals(record.uploadTokenHash, uploadTokenHash) ? record : null
}

async function acquireWithRetry(tryAcquire: () => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + SCENE_LOCK_RETRY_TOTAL_MS
  for (;;) {
    if (await tryAcquire()) return true
    const wait = SCENE_LOCK_RETRY_BASE_MS + Math.floor(Math.random() * SCENE_LOCK_RETRY_JITTER_MS)
    if (Date.now() + wait > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

function redemption(record: StoredUploadSession, uploadToken: string): SceneRedemption {
  return { sessionId: record.sessionId, purpose: record.purpose, mode: record.mode, expiresAt: record.expiresAt, uploadToken }
}

/**
 * 场景码不可用的统一出口。刻意**不区分**原因：格式错、查不到、已过期、已收到文件或已作废，
 * 对合法用户的补救动作完全一样，对探测者却会变成一台预言机。
 */
function sceneUnusableException(): BadRequestException {
  return new BadRequestException({
    error: { code: 'UPLOAD_SCENE_UNUSABLE', message: '二维码已失效，请回到一体机重新生成' },
  })
}

/** 令牌只存 sha256（文件头①）；上传、控制、场景三种令牌共用。 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
