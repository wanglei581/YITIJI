import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  HID_BURST_IDLE_MS,
  classifyHidKey,
  createHidBurstDetector,
} from './hidBurstDetector'
import './hid-guard.css'

/**
 * 授权扫码页白名单 —— 只有这两个页面消费扫码模组的键盘楔式输入：
 * - /print/cashier      收银台付款码（18 位数字，读满自动提交）
 * - /print/pickup-claim 取件码认领（10 位无歧义字符，读满自动核销）
 *
 * 其余页面一律默认吞掉（默认拒绝，不是黑名单）。
 * 已核对全仓：只有 CashierPaymentPanel 与 PrintPickupClaimPage 依赖 HID 输入，
 * 其它页面出现的「扫码」字样都是给用户手机去扫的二维码，或平板扫描仪，与本守卫无关。
 */
export const SCAN_AUTHORIZED_ROUTES = new Set(['/print/cashier', '/print/pickup-claim'])

/** 同一次连续误扫最多提示一次的节流窗口：模组常亮，路人反复晃码不该刷屏。 */
const NOTICE_THROTTLE_MS = 2000

type EditableTarget =
  | { kind: 'value'; el: HTMLInputElement | HTMLTextAreaElement; value: string; start: number | null; end: number | null }
  | { kind: 'text'; el: HTMLElement; value: string }

/** 把值写回 React 受控组件：必须走原生 setter 再派发 input，否则 React 状态不同步。 */
function restoreValue(target: EditableTarget) {
  if (target.kind === 'text') {
    target.el.textContent = target.value
    target.el.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }
  const proto =
    target.el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(target.el, target.value)
  else target.el.value = target.value
  target.el.dispatchEvent(new Event('input', { bubbles: true }))
  try {
    if (target.start !== null && target.end !== null) target.el.setSelectionRange(target.start, target.end)
  } catch {
    // number/email 等输入框不支持 setSelectionRange，忽略即可。
  }
}

/** 快照当前焦点控件的内容，供突发确认后回滚。非可编辑焦点返回 null。 */
function snapshotActiveEditable(): EditableTarget | null {
  const el = document.activeElement
  if (!el || !(el instanceof HTMLElement)) return null
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    let start: number | null = null
    let end: number | null = null
    try {
      start = el.selectionStart
      end = el.selectionEnd
    } catch {
      // 同上：部分 input type 不暴露 selection。
    }
    return { kind: 'value', el, value: el.value, start, end }
  }
  if (el.isContentEditable) return { kind: 'text', el, value: el.textContent ?? '' }
  return null
}

/**
 * 全局扫码误扫防护。
 *
 * 硬件事实：一体机装的是嵌入式影像扫码模组（常亮、自动触发、朝外），不是手持枪。
 * 它在操作系统眼里就是一个 USB 键盘，所以任何人举着任意码在机器前经过，内容都会
 * 以按键事件落进当前聚焦的控件 —— 用户可能正在填手机号或简历表单，脏数据会被一起
 * 提交落库；更糟的是付款码/取件码这类一次性凭证被写进普通表单。
 *
 * 本守卫在捕获阶段监听 window keydown：
 * 1. 用 hidBurstDetector 识别「连续高速按键」形态（判据与余量见该文件注释）。
 * 2. 突发确认前的前缀字符已经落进控件，因此在突发**起始**时快照焦点内容，
 *    确认后回滚 —— 光靠 preventDefault 挡不住已经落下去的前缀。
 * 3. 确认后的所有按键（含扫码器尾随的回车）一律 preventDefault + stopPropagation。
 *    尾随回车尤其危险：焦点若在按钮上，它等价于一次点击。
 * 4. 给用户一个明确提示。用户很可能根本不知道刚才发生了扫码，所以提示要说清
 *    「发生了什么 + 内容已丢弃 + 你的输入没被改动」。
 */
export function KioskHidScanGuard() {
  const { pathname } = useLocation()
  const enabled = !SCAN_AUTHORIZED_ROUTES.has(pathname)
  const [notice, setNotice] = useState(false)

  const detectorRef = useRef(createHidBurstDetector())
  const snapshotRef = useRef<EditableTarget | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNoticeAtRef = useRef(0)

  const finishBurst = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
    const snapshot = snapshotRef.current
    snapshotRef.current = null
    detectorRef.current.reset()
    if (snapshot) restoreValue(snapshot)

    const now = Date.now()
    if (now - lastNoticeAtRef.current < NOTICE_THROTTLE_MS) return
    lastNoticeAtRef.current = now
    setNotice(true)
  }, [])

  useEffect(() => {
    if (!enabled) return

    const detector = detectorRef.current
    detector.reset()
    snapshotRef.current = null

    const onKeyDown = (event: KeyboardEvent) => {
      const action = detector.feed(classifyHidKey(event), event.timeStamp)

      if (action === 'start') {
        // 上一串还挂着待收尾的 idle 定时器时，必须先收尾再取新快照。
        // 否则新快照会把上一串漏进控件的前缀字符一起拍进去，定时器随后「回滚」到
        // 这个已被污染的快照，前缀就永远清不掉了。
        if (idleTimerRef.current) finishBurst()
        snapshotRef.current = snapshotActiveEditable()
        return
      }
      if (action === 'pass') return

      // suppress / finish：这一串已被确认为扫码突发，一律不许落进页面。
      event.preventDefault()
      event.stopPropagation()

      if (action === 'finish') {
        finishBurst()
        return
      }

      // 无回车后缀的扫码配置：静默一小段时间后自行收尾。
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(finishBurst, HID_BURST_IDLE_MS)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
      detector.reset()
      snapshotRef.current = null
    }
  }, [enabled, finishBurst])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(false), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  if (!notice) return null

  return (
    <div className="kiosk-hid-notice" role="status" aria-live="polite" data-testid="hid-scan-notice">
      <b className="kiosk-hid-notice-title">已忽略一次扫码</b>
      <p className="kiosk-hid-notice-body">
        扫码设备在本页读到了一串内容。本页不需要扫码，内容已丢弃，你正在填写的内容没有被改动。
      </p>
      <p className="kiosk-hid-notice-hint">如需支付或取件，请先进入对应页面再扫码。</p>
    </div>
  )
}
