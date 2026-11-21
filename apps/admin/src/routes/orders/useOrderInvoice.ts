import { useCallback, useEffect, useState } from 'react'
import { adminInvoiceService, type AdminInvoiceView } from '../../services/api/adminInvoice'
import { ApiHttpError } from '../../services/api/client'

export function useOrderInvoice(orderId: string, orderKind: 'print' | 'service') {
  const [view, setView] = useState<AdminInvoiceView | null>(null)
  const [phase, setPhase] = useState<'loading' | 'empty' | 'ready'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    setError(null)
    setView(null)
    adminInvoiceService.getByOrder(orderId, orderKind).then(
      (next) => {
        if (cancelled) return
        setView(next)
        setPhase('ready')
      },
      (err: unknown) => {
        if (cancelled) return
        setView(null)
        if (err instanceof ApiHttpError && err.status === 404) {
          setPhase('empty')
          return
        }
        setPhase('empty')
        setError(err instanceof ApiHttpError ? err.message : '开票申请暂时读不出来。请稍后重试。')
      },
    )
    return () => {
      cancelled = true
    }
  }, [orderId, orderKind])

  /** 动作没成（含 409：别人先动了、订单退了款）后重读一次，按库里最新的状态画；读不出来就留着原样，错误句已经写上。 */
  const reload = useCallback(async () => {
    try {
      setView(await adminInvoiceService.getByOrder(orderId, orderKind))
      setPhase('ready')
    } catch {
      /* 留着原样 */
    }
  }, [orderId, orderKind])

  /** 成功返回 true，表单才收起；失败返回 false，表单与刚填的内容留着。 */
  const markIssued = useCallback(async (invoiceNo: string): Promise<boolean> => {
    if (!view) return false
    setBusy(true)
    setError(null)
    try {
      setView(await adminInvoiceService.markIssued(view.id, invoiceNo))
      return true
    } catch (err) {
      setError(err instanceof ApiHttpError ? err.message : '标已开没有成功。请稍后重试。')
      await reload()
      return false
    } finally {
      setBusy(false)
    }
  }, [view, reload])

  const returnRequest = useCallback(async (reason: string): Promise<boolean> => {
    if (!view) return false
    setBusy(true)
    setError(null)
    try {
      setView(await adminInvoiceService.returnRequest(view.id, reason.trim()))
      return true
    } catch (err) {
      setError(err instanceof ApiHttpError ? err.message : '退回没有成功。请稍后重试。')
      await reload()
      return false
    } finally {
      setBusy(false)
    }
  }, [view, reload])

  return { view, phase, error, busy, markIssued, returnRequest }
}
