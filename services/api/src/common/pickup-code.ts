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
 * 取件码长度：8（产品裁决 2026-08-18 方案 A：8 位数字 + 7 天有效期 +
 * 合并预言机错误码 + 按终端失败锁定）。
 *
 * ── 为什么不是 6 位 ────────────────────────────────────────────────────
 * 立项论证是「100 万 ÷ 20 次每分钟 ≈ 35 天跑不完键空间」。算术没错，指标错了：
 * 攻击者不需要跑完键空间，也不需要命中某一枚指定的码 —— 命中**任意一枚在用的码**
 * 就能释放别人的文件。正确指标是「首次命中任意在用码的期望时间」：
 *
 *     设同时在用的码有 N 枚、键空间 S，单次猜中概率 = N/S，
 *     窗口内可发 K 次请求时，至少命中一次的概率 = 1 − exp(−N·K/S)。
 *     N ≈ 日单量 × 有效期天数。
 *
 * 6 位（S=10^6）按日单量 50 算：24 小时窗口命中概率已约 76%，7 天约 100%。
 * 即 6 位在**当时的 24 小时现状口径下就已经不成立**，不只是 7 天不成立。
 *
 * ── 8 位 + 7 天为什么仍然需要锁定机制 ─────────────────────────────────
 * S=10^8、N=350（日单量 50 × 7 天）、仅靠 20 次/分钟限流时
 * K = 201,600 → 命中概率 **仍有约 50.6%**。
 * 所以 `pickup-claim-lockout.ts` 的按终端失败锁定**不是锦上添花，是承重的**：
 * 10 次失败/10 分钟 + 15 分钟锁定把 K 压到约 4,032 → 命中概率约 **1.4%**。
 * 动锁定参数 = 动这个结论，先重算再改。
 *
 * ── 依然成立的注意事项 ────────────────────────────────────────────────
 * 限流按**出口 IP** 计（`print-jobs.controller.ts` 的 `@Throttle` default 桶，
 * 未打 `@TerminalScopedThrottle`），换 IP 即换配额 —— 这正是锁定必须按**终端**
 * 而不是按 IP 计数的原因。`x-terminal-id` 是匿名端点上的客户端可伪造请求头
 * （见 `common/throttler/terminal-throttle.ts` 顶部），且 `requireTerminal`
 * 接受低熵的 `terminalCode`（形如 KSK-001），所以「必须在正确终端」不构成强约束。
 *
 * ── 已知长期问题（与有效期无关，只由累计签发量驱动）────────────────────
 * 取件码只增不减：`Order.pickupCode` / `pickupCodeHash` 都是全表永久 @unique，
 * 订单过期或完成后**不回收**。`generateUniquePickupCode` 预检 6 次后 fail-closed，
 * 累计签发量 C 时预检全撞概率 (C/S)^6。改到 8 位后 S=10^8，
 * C=300 万时才约 7.3e-4 —— 比 6 位宽裕约两个数量级，但回收机制仍须单独立项。
 */
export const PICKUP_CODE_LENGTH = 8

/** 取件码格式：恰好 8 位纯数字。 */
export const PICKUP_CODE_PATTERN = /^[0-9]{8}$/

// ── 存量（2026-08-18 之前签发的码）─────────────────────────────────────────
//
// 改长度**不会**让库里的旧码失效：认领走 `Order.pickupCodeHash` 精确命中
// （`pickup-order.service.ts`），哈希与长度无关，`hashPickupCode` 的域分隔串
// 也不能动（一改，全部存量哈希立刻对不上）。
//
// 真正会让已付费用户取不到件的是**校验正则**：旧码 10 位，新正则只收 8 位，
// 请求在 `ClaimPickupDto` 就被 400 掉，根本走不到哈希查询那一步。
// 所以下面这套 legacy 常量在过渡期内必须被 DTO 与 kiosk 输入框一起接受。
//
// 何时可以删：最后一枚 10 位码过期之后 = **本改动上线满 24 小时**。
// 注意别被新 TTL 误导：新码 TTL 是 7 天，但**存量码是按当时的 24h TTL 签发的**，
// 它们的 `pickupCodeExpiresAt` 早已落库且不会被重算（见 PICKUP_TTL_MS 说明），
// 所以等的是 24 小时，不是 7 天。

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
export const PICKUP_CODE_ACCEPTED_PATTERN = /^(?:[0-9]{8}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10})$/

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

/** 是否为当前签发格式（8 位纯数字）。 */
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
