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
 * ② **一次性。** 兑换成功即删索引键，并给会话**轮换一把新的 uploadToken**。
 *    轮换而不是复用，是因为旧 token 的明文服务端根本没有（见①），换不回来；
 *    顺带的好处是先兑先得：同一张码被拍照传播后，第二个人换不到东西。
 *
 * ③ **字符集必须过微信那一关。** base64url 只含 `A-Za-z0-9-_`，
 *    落在 miniapp-code 的 SCENE_PATTERN 里；18 字节 → 24 字符，
 *    既有 144 位熵，又留了余量不贴着 32 的上限。
 */
import { createHash, randomBytes } from 'crypto'

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
