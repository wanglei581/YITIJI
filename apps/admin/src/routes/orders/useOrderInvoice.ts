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

  const markIssued = useCallback(async (invoiceNo: string) => {
    if (!view) return
    setBusy(true)
    setError(null)
    try {
      setView(await adminInvoiceService.markIssued(view.id, invoiceNo))
    } catch (err) {
      setError(err instanceof ApiHttpError ? err.message : '标已开没有成功。请稍后重试。')
    } finally {
      setBusy(false)
    }
  }, [view])

  const returnRequest = useCallback(async (reason: string) => {
    if (!view) return
    setBusy(true)
    setError(null)
    try {
      setView(await adminInvoiceService.returnRequest(view.id, reason.trim()))
    } catch (err) {
      setError(err instanceof ApiHttpError ? err.message : '退回没有成功。请稍后重试。')
    } finally {
      setBusy(false)
    }
  }, [view])

  return { view, phase, error, busy, markIssued, returnRequest }
}
