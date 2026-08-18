/**
 * 取件码 / 到机码规格 —— **后端唯一定义**（生成 + 校验 + 哈希）。
 *
 * **契约源**：`packages/shared/src/pickupCode.ts`。
 * 为什么不直接 import @ai-job-print/shared：services/api 走 commonjs + node
 * moduleResolution，packages/shared 的 exports 直指 .ts，互操作复杂 ——
 * 既有约定见 `src/payment/payment.types.ts` / `src/files/file.types.ts` 顶部说明。
 * 两处字面量由 `scripts/verify-backend-p0-contracts.mjs` 逐字断言相等。
 *
 * ── 这个文件解决的是什么 bug ────────────────────────────────────────────
 * 本文件出现之前，`PICKUP_CODE_LEN = 10` 在
 *   - `src/member-print-orders/member-print-order-create.service.ts:15`
 *   - `src/payment/order-status.service.ts:15`
 * 各写了一份，`src/print-jobs/dto/claim-pickup.dto.ts` 又内联了第三份长度
 * （正则里的 `{10}`）。三者没有任何编译期或门禁联系。
 * 只要有人改其中一处，系统就会**按一种长度签发、按另一种长度受理** ——
 * 所有在途取件码当场作废，且已付费用户拿不到自己的文件。
 * 所以「长度只有一处」不是洁癖，是这条不变量的唯一实现方式：
 *
 *     randomPickupCode() 的输出，必须恒被 ClaimPickupDto 受理。
 *
 * 该不变量由 `scripts/verify-miniapp-cloud-print-m2.ts` 实跑钉住。
 */
import { createHash, randomBytes } from 'crypto'

/** 取件码字符集：纯数字，10 个字符。纯数字天然没有 O/0、I/1 混淆问题。 */
export const PICKUP_CODE_ALPHABET = '0123456789'

/**
 * 取件码长度：6（产品裁决 2026-08-18，由 10 位字母数字改为 6 位纯数字）。
 *
 * ⚠️ **未决安全事项 —— 合并前必须先有裁决，不要把本注释当作「已论证安全」**。
 *
 * 立项时给出的论证是：「100 万种 ÷ 20 次/分钟 ≈ 35 天才能跑完整个键空间，
 * 而码 24 小时失效，所以枚举不可行」。**这个论证用错了指标。**
 * 攻击者不需要跑完键空间，也不需要命中某一枚指定的码 —— 命中**任意一枚在用的码**
 * 就能释放别人的文件。正确的指标是「首次命中任意在用码的期望时间」：
 *
 *     设同一时刻可认领的码有 N 枚，单次猜中概率 = N / 10^6，
 *     20 次/分钟下首次命中期望时间 ≈ 50000 / N 分钟。
 *     N=50 → 约 17 小时；N=100 → 约 8 小时；N=500 → 约 1.7 小时。
 *
 * 而 N ≈ 日单量 × 有效期天数。按日单量 50 计算，24 小时有效期下
 * 单一 IP 一天内命中概率已约 76%（1 − e^(−1.44)）。也就是说
 * **6 位在 24 小时口径下就已经不成立，不只是 7 天不成立。**
 *
 * 其余三条控制补不上这个缺口：
 *   - 限流按**出口 IP** 计（`print-jobs.controller.ts` 的 `@Throttle` default 桶，
 *     未打 `@TerminalScopedThrottle`），换 IP 即换配额；
 *   - `x-terminal-id` 是匿名端点上的**客户端可伪造请求头**
 *     （见 `common/throttler/terminal-throttle.ts` 顶部说明），
 *     且 `requireTerminal` 接受低熵的 `terminalCode`（形如 KSK-001）；
 *   - `PICKUP_CODE_INVALID`(404) 与 `PICKUP_TERMINAL_MISMATCH`(403) 是**两种不同响应**，
 *     构成「这枚码是否真实存在」的预言机 —— 攻击者不必待在正确的终端也能筛出真码。
 *
 * 因此：**在产品/安全裁决落地之前，本常量不得被当成已验证的安全参数。**
 * 一旦裁决改长度，本文件是唯一需要改的地方（这正是把它收敛成单一来源的意义）。
 *
 * **已知长期问题（与有效期无关，只由累计签发量驱动）**：取件码只增不减 ——
 * `Order.pickupCode` / `Order.pickupCodeHash` 都是全表永久 @unique，
 * 订单过期或完成后**不回收**。`generateUniquePickupCode` 预检 6 次后 fail-closed，
 * 累计签发量 C 时预检全撞的概率为 (C/10^6)^6：C=30 万时约 1/1400，
 * C=50 万时约 1.6% —— 即「用户已付款却拿不到取件码」。回收/归档机制必须单独立项。
 */
export const PICKUP_CODE_LENGTH = 6

/** 取件码格式：恰好 6 位纯数字。 */
export const PICKUP_CODE_PATTERN = /^[0-9]{6}$/

// ── 存量（2026-08-18 之前签发的码）─────────────────────────────────────────
//
// 改长度**不会**让库里的旧码失效：认领走 `Order.pickupCodeHash` 精确命中
// （`pickup-order.service.ts`），哈希与长度无关，`hashPickupCode` 的域分隔串
// 也不能动（一改，全部存量哈希立刻对不上）。
//
// 真正会让已付费用户取不到件的是**校验正则**：旧码 10 位，新正则只收 6 位，
// 请求在 `ClaimPickupDto` 就被 400 掉，根本走不到哈希查询那一步。
// 所以下面这套 legacy 常量在过渡期内必须被 DTO 与 kiosk 输入框一起接受。
//
// 何时可以删：最后一个 10 位码过期之后。取件码 TTL 24h，
// 故「本改动上线满 24 小时」即为充分条件，不需要查库。

/** 存量取件码字符集：31 个字符（36 个字母数字去掉易混的 0 1 I L O）。注意串里**有 U**。 */
export const LEGACY_PICKUP_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** 存量取件码长度：10。 */
export const LEGACY_PICKUP_CODE_LENGTH = 10

/** 存量取件码格式：恰好 10 位、取自 31 字符集。 */
export const LEGACY_PICKUP_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/

/**
 * 受理格式 = 新码 ∪ 存量码。**生成端只发新码**，本正则只放宽「收」不放宽「发」。
 * `ClaimPickupDto` 必须直接用这一条，不许再内联正则。
 */
export const PICKUP_CODE_ACCEPTED_PATTERN = /^(?:[0-9]{6}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10})$/

/**
 * 生成一枚取件码。
 *
 * 随机源：`crypto.randomBytes`（CSPRNG）。**绝不能换成 `Math.random()`** ——
 * 它是可预测的 PRNG，对能换来一份他人文件的凭证来说不够。
 *
 * 取模偏置：改用拒绝采样。旧实现是 `bytes[i] % alphabet.length`，
 * 256 % 31 = 8，即前 8 个字符各多出 1/256 的权重；换成 10 进制后
 * 256 % 10 = 6，偏置会放大到「0–5 比 6–9 多约 4%」。这不是致命漏洞，
 * 但它是白送给攻击者的先验，而消除它只需要丢掉 250 以上的字节。
 */
export function randomPickupCode(): string {
  const size = PICKUP_CODE_ALPHABET.length
  // 拒绝阈值：只接受落在 [0, limit) 的字节，使每个字符等概率。
  const limit = 256 - (256 % size)
  let out = ''
  while (out.length < PICKUP_CODE_LENGTH) {
    for (const byte of randomBytes(PICKUP_CODE_LENGTH)) {
      if (byte >= limit) continue
      out += PICKUP_CODE_ALPHABET[byte % size]
      if (out.length === PICKUP_CODE_LENGTH) break
    }
  }
  return out
}

/**
 * 取件码哈希（用于 `Order.pickupCodeHash` 精确查询与唯一约束）。
 *
 * **域分隔串 `m2-pickup-v1|` 不得修改**：一旦改动，库里全部存量
 * `pickupCodeHash` 立即失配，所有在途订单无法认领。改码长不影响它，
 * 因为 sha256 的输入长度本来就是可变的。
 */
export function hashPickupCode(code: string): string {
  return createHash('sha256').update(`m2-pickup-v1|${code}`).digest('hex')
}

/** 是否为当前签发格式（6 位纯数字）。 */
export function isCurrentPickupCode(code: string): boolean {
  return PICKUP_CODE_PATTERN.test(code)
}

/** 是否为存量格式（10 位、31 字符集）。 */
export function isLegacyPickupCode(code: string): boolean {
  return LEGACY_PICKUP_CODE_PATTERN.test(code)
}

/** 服务端是否受理该码（新 ∪ 存量）。必须与 `ClaimPickupDto` 判定一致。 */
export function isAcceptedPickupCode(code: string): boolean {
  return PICKUP_CODE_ACCEPTED_PATTERN.test(code)
}
