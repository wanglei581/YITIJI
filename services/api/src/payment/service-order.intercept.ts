import type { ServiceOrderService, TripHold } from './service-order.service'

type Headers = Record<string, string | string[] | undefined> | undefined

type HoldOrders = Pick<ServiceOrderService, 'beginTrip' | 'coversTrip' | 'noteLayoutOnly'>

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return null
  const getResponse = (error as { getResponse?: () => unknown }).getResponse
  if (typeof getResponse !== 'function') return null
  const response = getResponse()
  if (typeof response === 'string') return response
  if (response && typeof response === 'object' && 'error' in response) {
    const code = (response as { error?: { code?: string } }).error?.code
    return code ?? null
  }
  return null
}

/**
 * 开始改写之前占用这一趟。缓存命中和诊断失败由 run 自己在调用 beforeGenerate 之前返回，这里不扣。
 * orders 不是带 beginTrip 的服务时（测试替身）直接跑，行为与加收费之前一样。
 */
export async function chargeResumeOptimizeStart<T extends { status?: string }>(
  orders: HoldOrders | undefined,
  headers: Headers,
  taskId: string,
  run: (beforeGenerate: () => Promise<boolean>) => Promise<T>,
): Promise<T> {
  const hold = orders && typeof orders.beginTrip === 'function'
    ? await orders.beginTrip(headers, 'resume_optimize')
    : null
  let consumed = false
  try {
    const result = await run(async () => {
      if (!hold?.required) return false
      await hold.consume(taskId)
      consumed = true
      return true
    })
    if (consumed) await settleOptimize(hold, result.status)
    return result
  } catch (error) {
    if (consumed) await hold?.noteNotMade('optimize_failed')
    throw error
  }
}

async function settleOptimize(hold: TripHold | null, status: string | undefined): Promise<void> {
  if (status === 'completed') await hold?.noteMade()
  else await hold?.noteNotMade('optimize_failed')
}

/** 已有面试官发言说明这场开过了，不再占用、不再收款。 */
export async function chargeInterviewStart<T>(
  orders: HoldOrders | undefined,
  headers: Headers,
  sessionId: string,
  alreadyOpen: boolean,
  run: (skipDailyQuota: boolean) => Promise<T>,
): Promise<T> {
  if (alreadyOpen || !orders || typeof orders.beginTrip !== 'function') return run(false)
  const hold = await orders.beginTrip(headers, 'mock_interview')
  if (!hold.required) return run(false)
  await hold.consume(sessionId)
  try {
    const result = await run(true)
    await hold.noteMade()
    return result
  } catch (error) {
    if (errorCode(error) === 'INTERVIEW_ALREADY_STARTED') await hold.noteMade()
    else await hold.noteNotMade('interview_not_opened')
    throw error
  }
}

/** 扫描先占单，文件稍后才到。创建失败记没出文件。 */
export async function chargeScanStart<T extends { scanTaskId: string }>(
  orders: HoldOrders | undefined,
  headers: Headers,
  run: () => Promise<T>,
): Promise<T> {
  const hold = orders && typeof orders.beginTrip === 'function'
    ? await orders.beginTrip(headers, 'scan')
    : null
  if (!hold?.required) return run()
  await hold.consume('pending')
  try {
    const result = await run()
    await hold.attachRef(result.scanTaskId)
    return result
  } catch (error) {
    await hold.noteNotMade('scan_no_file')
    throw error
  }
}

/** 收费机器上，已开始的简历这一趟还盖得住岗位对照和排版。不收费返回空。 */
export async function resumeTripCover(
  orders: HoldOrders | undefined,
  headers: Headers,
): Promise<{ orderId: string | null; skipDailyQuota: boolean }> {
  if (!orders || typeof orders.coversTrip !== 'function') return { orderId: null, skipDailyQuota: false }
  const orderId = await orders.coversTrip(headers, 'resume_optimize')
  return { orderId, skipDailyQuota: Boolean(orderId) }
}
