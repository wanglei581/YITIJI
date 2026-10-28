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
import { createHash, createHmac, randomBytes } from 'crypto'

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
