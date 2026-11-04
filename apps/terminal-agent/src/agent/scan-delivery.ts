/**
 * agent/scan-delivery.ts — 扫描件受保护投递（multipart 上传 + 失败归类）
 *
 * 从 scan-watcher.ts 的 processCandidate 原样抽出，面板路线（watcher）走它时
 * 行为与抽取前一字不差：
 *   - 表单字段与顺序：file、scanTaskId、deliveryLease、candidateSnapshotAt、observedAt
 *   - POST /terminals/:terminalId/scan-sessions/deliver，请求头取 form.getHeaders()，
 *     禁用 axios 层自动重试（NO_RETRY_CONFIG，原因见 postScanDeliveryForm）
 *   - 后端 error.code → 「永久拒绝」六类或「可重试」，见 classifyScanDeliveryFailure
 *
 * 可选的 origin（'watcher' | 'device'）：本批（A1）没有任何调用方传它。不传 = 表单里
 * 没有这个字段 = 线上字节与抽取前相同。屏上扫描接线（A2）且后端先认该字段之后才会传，
 * 后端全局 forbidNonWhitelisted，终端程序单边加字段会 400，所以这里只留口子、不启用。
 *
 * 本模块不碰文件系统、不写日志、不改任何全局状态：隔离、删除、重试时限、401 闩锁
 * 这些带副作用的后果，仍由调用方（scan-watcher）按归类结果决定。
 */

import FormData from 'form-data'
import type { AxiosInstance } from 'axios'
import { NO_RETRY_CONFIG } from './api-client'

export type ScanDeliveryOrigin = 'watcher' | 'device'

export interface ScanDeliveryFormInput {
  bytes: Buffer
  filename: string
  scanTaskId: string
  deliveryLease: string
  /**
   * 可信快照时间（调用方传原始 mtimeMs 转出的 ISO，严禁夹值伪造时间证据）。
   * observedAt 与它同值，沿用 watcher 的原做法。
   */
  candidateSnapshotAt: string
  /** 本批无调用方传入。不传则表单里没有 origin 字段。 */
  origin?: ScanDeliveryOrigin
}

export function guessScanMimeType(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

/** 构造投递表单。字段与顺序必须与抽取前相同（verify:scan-device-engine 有等价断言）。 */
export function buildScanDeliveryForm(input: ScanDeliveryFormInput): FormData {
  const form = new FormData()
  form.append('file', input.bytes, {
    filename: input.filename,
    contentType: guessScanMimeType(input.filename),
  })
  form.append('scanTaskId', input.scanTaskId)
  form.append('deliveryLease', input.deliveryLease)
  form.append('candidateSnapshotAt', input.candidateSnapshotAt)
  form.append('observedAt', input.candidateSnapshotAt)
  if (input.origin !== undefined) form.append('origin', input.origin)
  return form
}

/**
 * 发出投递请求。
 *
 * NO_RETRY_CONFIG: `form` 是一次性消费的流，axios 拦截器的自动重试会复用
 * 同一个已耗尽的请求体，导致 Content-Length 与实际重发字节不匹配、服务端
 * 请求 end 事件永不触发——真实 5xx 场景下会让每次重试都卡满 30s 超时
 * （3 次共 100+ 秒）。失败已由调用方自身的 sweep 重试机制兜底，禁用
 * axios 层重试不影响最终投递成功率。
 *
 * terminalId 保持抽取前 `${config.terminalId}` 的拼接语义：watcher 路径上，
 * fetchScanLease 对空 terminalId 返回 null，不会走到这里。
 */
export async function postScanDeliveryForm(
  client: AxiosInstance,
  terminalId: string | undefined,
  form: FormData,
): Promise<void> {
  await client.post(`/terminals/${terminalId}/scan-sessions/deliver`, form, {
    headers: form.getHeaders(),
    ...NO_RETRY_CONFIG,
  })
}

// ── 失败归类 ──────────────────────────────────────────────────────────────

/**
 * 后端明确、永久拒绝这份投递的六类原因。每一类都意味着「这次匹配已经失效，
 * 重试没有意义，而且重试可能把文件挂到后一个用户身上」。
 */
export type ScanDeliveryRefusal =
  | 'no_waiting_task'
  | 'lease_invalid'
  | 'task_state_changed'
  | 'file_already_delivered'
  | 'file_previously_attempted'
  | 'file_stale_capture'

export type ScanDeliveryFailure =
  | { kind: 'refused'; refusal: ScanDeliveryRefusal; code: string }
  | { kind: 'retryable'; code: string | undefined }

/** 读后端结构化错误码。读不到返回 undefined（网络错误、无 body、body 无 error 字段）。 */
export function readScanDeliveryErrorCode(error: unknown): string | undefined {
  return (error as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
}

// Map 而不是对象字面量：后端返回的 code 是外部输入，'constructor' / '__proto__' 之类
// 的字符串不能命中原型链上的属性。
const REFUSAL_BY_CODE: ReadonlyMap<string, ScanDeliveryRefusal> = new Map<string, ScanDeliveryRefusal>([
  ['NO_WAITING_SCAN_TASK', 'no_waiting_task'],
  ['SCAN_LEASE_INVALID', 'lease_invalid'],
  ['SCAN_LEASE_EXPIRED', 'lease_invalid'],
  ['SCAN_TASK_STATE_CHANGED', 'task_state_changed'],
  ['SCAN_FILE_ALREADY_DELIVERED', 'file_already_delivered'],
  ['SCAN_FILE_PREVIOUSLY_ATTEMPTED', 'file_previously_attempted'],
  ['SCAN_FILE_STALE_CAPTURE', 'file_stale_capture'],
])

/**
 * 把一次失败的投递归类。401 不在这里处理：它要闩锁并保留文件，由调用方在归类之前
 * 先用 preserveScanFileForUnauthorized 拦下。
 *
 * B1-11（Critical code-review 修复 #2）：SCAN_TASK_STATE_CHANGED 说明这份文件在服务端
 * 确实被匹配、CAS 到过 'matched'，但最终 CAS-to-completed 落空（任务在上传期间被取消或
 * 状态变化——服务端已经用 systemDelete() 补偿删掉了那次真实上传出的孤儿文件，见
 * scan-tasks.service.ts deliverScanFile() 的 SCAN_TASK_STATE_CHANGED 分支）。这次"匹配"
 * 已经明确、永久失效——不是网络抖动，绝不能留给下一轮 sweep 重试：重试时该终端"当前
 * waiting 任务"完全可能已经变成另一个用户的新会话（原用户的任务已经不在，
 * 终端已经空出来），继续重试会把这份文件错误地挂到那个新用户身上——跨用户 PII 误挂载。
 * 必须像 NO_WAITING_SCAN_TASK 一样立即隔离，绝不重试；日志措辞与两个既有 _unclaimed
 * 归宿（无等待任务 / 重试超时）分别不同，避免运维排查时混淆三种不同的原因。
 *
 * B1-11（点 4 边缘案例修复）：SCAN_FILE_ALREADY_DELIVERED 说明这份文件内容此前已经
 * 真正投递成功过——最可能的原因是上一次投递其实已经在服务端完成，只是 HTTP 响应在
 * 回传给本 Agent 的路上丢失，本 Agent 才把它误当成失败留在原地准备重试。继续重试
 * 没有意义（内容已经交付过），而且和 SCAN_TASK_STATE_CHANGED 一样有跨用户误挂载
 * 风险（重试会被匹配到该终端当前 waiting 任务，可能已经属于另一个用户）——
 * 同样必须立即隔离，不重试。
 *
 * 其余（网络错误、5xx、无法识别的 code）一律 retryable：默认留在原地交给下一轮 sweep
 * 重试，重试时长上限由调用方按文件自身 mtime 判断，不是这里。
 */
export function classifyScanDeliveryFailure(error: unknown): ScanDeliveryFailure {
  const code = readScanDeliveryErrorCode(error)
  if (typeof code === 'string') {
    const refusal = REFUSAL_BY_CODE.get(code)
    if (refusal) return { kind: 'refused', refusal, code }
  }
  return { kind: 'retryable', code }
}
