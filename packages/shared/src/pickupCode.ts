/**
 * 取件码 / 到机码规格 —— 跨端契约源。
 *
 * **为什么这个文件存在**：这份规格此前在仓库里散落了 5 份互相独立的字面量
 * （services/api 两份 `PICKUP_CODE_LEN`、DTO 一条内联正则、kiosk 页面一条内联正则、
 * miniapp 一条内联正则）。两份不同步时的后果不是「界面不好看」，而是
 * **生成一种长度、校验另一种长度 → 全部取件码当场作废**。所以规格必须收敛。
 *
 * 落地边界（诚实标注，不假装做到了「全仓唯一一份」）：
 *
 * - `services/api` 走 commonjs + node moduleResolution，无法 import 本包
 *   （既有约定见 `services/api/src/payment/payment.types.ts` 顶部说明）；
 *   小程序是原生 WeChat 工程，没有打包步骤，也 import 不了本包。
 * - 因此运行期实际存在 3 份副本：本文件（kiosk 等 TS 前端）、
 *   `services/api/src/common/pickup-code.ts`（后端，**唯一有权受理/拒绝取件的那份**）、
 *   `apps/miniapp/utils/pickup-qrcode.js`（小程序）。
 * - 三份的字面量由门禁 `services/api/scripts/verify-backend-p0-contracts.mjs`
 *   逐字断言相等。副本可以有，漂移不行。
 *
 * 改这里 = 同时改后端那份 + 小程序那份，否则门禁红。
 */

/** 取件码字符集：纯数字，10 个字符。纯数字天然没有 O/0、I/1 混淆问题。 */
export const PICKUP_CODE_ALPHABET = '0123456789'

/**
 * 取件码长度：6。
 *
 * ⚠️ **未决安全事项**：立项时的「100 万 ÷ 20 次每分钟 ≈ 35 天跑不完」这个论证
 * 用错了指标 —— 攻击者只需命中**任意一枚在用的码**，期望时间 ≈ 50000/N 分钟
 * （N = 同时在用的码数 ≈ 日单量 × 有效期天数）。完整推导与补偿方案见
 * `services/api/src/common/pickup-code.ts` 上的说明。
 * **裁决落地前不要把这个数字当成已验证的安全参数。**
 */
export const PICKUP_CODE_LENGTH = 6

/** 取件码格式：恰好 6 位纯数字。 */
export const PICKUP_CODE_PATTERN = /^[0-9]{6}$/

// ── 存量（2026-08-18 之前签发的码）─────────────────────────────────────────
//
// 改长度**不会**让库里的旧码失效：认领走 `pickupCodeHash` 精确命中，
// 哈希与长度无关。真正会让已付费用户取不到件的是**校验正则**——
// 旧码 10 位，新正则只收 6 位，请求在 DTO 就 400，根本到不了哈希查询。
// 所以下面这套 legacy 常量在过渡期内必须被 DTO 与 kiosk 输入框一起接受。
//
// 何时可以删：最后一个 10 位码过期之后。取件码 TTL 24h（`PICKUP_TTL_MS`），
// 故「本改动上线满 24 小时」即为充分条件，不需要查库。

/** 存量取件码字符集：31 个字符（36 个字母数字去掉易混的 0 1 I L O）。注意串里**有 U**。 */
export const LEGACY_PICKUP_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** 存量取件码长度：10。 */
export const LEGACY_PICKUP_CODE_LENGTH = 10

/** 存量取件码格式：恰好 10 位、取自 31 字符集。 */
export const LEGACY_PICKUP_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/

/**
 * 受理格式 = 新码 ∪ 存量码。**生成端只发新码**，本正则只放宽「收」不放宽「发」。
 *
 * 服务端 DTO 与 kiosk 输入框都必须用这一条，两边各写各的就是本次要根治的病。
 */
export const PICKUP_CODE_ACCEPTED_PATTERN = /^(?:[0-9]{6}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10})$/

/**
 * 输入框可键入的字符 = 两套字符集的并集（33 个）。
 * 用于过滤粘贴/扫码内容里的分隔符与非法字符，不代表这些组合都能通过校验。
 */
export const PICKUP_CODE_INPUT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** 输入框最大可键入长度 = 两套长度的较大者。 */
export const PICKUP_CODE_MAX_INPUT_LENGTH = 10

/** 是否为当前签发格式（6 位纯数字）。 */
export function isCurrentPickupCode(code: string): boolean {
  return PICKUP_CODE_PATTERN.test(code)
}

/** 是否为存量格式（10 位、31 字符集）。 */
export function isLegacyPickupCode(code: string): boolean {
  return LEGACY_PICKUP_CODE_PATTERN.test(code)
}

/** 服务端是否受理该码（新 ∪ 存量）。与 `ClaimPickupDto` 的判定必须一致。 */
export function isAcceptedPickupCode(code: string): boolean {
  return PICKUP_CODE_ACCEPTED_PATTERN.test(code)
}
