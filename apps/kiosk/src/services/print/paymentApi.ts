// ============================================================
// Payment API — C5-3 Kiosk 收银 / 支付状态轮询
//
// Thin fetch wrappers around（全局前缀 /api/v1）：
//   POST /orders/:id/pay              — 出码（建/幂等复用支付尝试，返回屏上动态码）
//   GET  /orders/:id/pay-status       — 轮询支付状态（含惰性过期/关单、paid 后 pickupCode）
//   POST /payment/sandbox/simulate    — 沙箱模拟支付（**仅非生产**；DEV 构建 + 后端非 production 才可用）
//
// 鉴权口径：与 printJobsApi 一致 —— Kiosk 匿名层，orderId 为不可猜 cuid，不带登录态。
// 仅在 API_MODE === 'http' 下调用（mock 模式打印流程走 SIM，不进收银页）。
// 调用方需处理错误（网络/404/ONLINE_PAYMENT_DISABLED 等），不得静默伪造已支付。
//
// 合规：本文件不持有任何密钥；沙箱动态码 `qrCodeContent` 为自描述测试 scheme，不指向真实收款地址。
// ============================================================

import { API_BASE_URL } from '../api/client'
import type { PayAttemptView, PayStatusView } from '@ai-job-print/shared'

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  // 尝试解出后端错误码（{ error: { code } } 或 { message }），失败则回退原文。
  try {
    const body = JSON.parse(text) as { error?: { code?: string }; message?: string | string[] }
    const code = body.error?.code
    if (code) return code
    if (typeof body.message === 'string') return body.message
    if (Array.isArray(body.message)) return body.message.join('; ')
  } catch {
    /* 非 JSON，回退 */
  }
  return text || `HTTP ${res.status}`
}

/** 出码：为付费订单创建（或幂等复用未过期的）支付尝试，返回屏上动态码内容。 */
export async function createPayAttempt(orderId: string): Promise<PayAttemptView> {
  const res = await fetch(`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`createPayAttempt failed: ${res.status} ${await readError(res)}`)
  return res.json() as Promise<PayAttemptView>
}

/** 查询支付状态（收银页轮询用）；paid 且可见时返回 pickupCode。 */
export async function getPayStatus(orderId: string): Promise<PayStatusView> {
  const res = await fetch(`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}/pay-status`)
  if (!res.ok) throw new Error(`getPayStatus failed: ${res.status} ${await readError(res)}`)
  return res.json() as Promise<PayStatusView>
}

/**
 * 沙箱模拟支付（**仅非生产**）：后端按库内 attempt 真实数据构造签名合法回调，
 * 走与真实回调完全相同的验签/匹配/入账路径（不给模拟支付开任何旁门）。
 * 生产后端返回 404 / SANDBOX_ONLY —— 调用方据 DEV 构建门控，绝不在生产 UI 暴露。
 */
export async function simulateSandboxPayment(
  attemptId: string,
  result: 'success' | 'failed',
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/payment/sandbox/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId, result }),
  })
  if (!res.ok) throw new Error(`simulateSandboxPayment failed: ${res.status} ${await readError(res)}`)
}
