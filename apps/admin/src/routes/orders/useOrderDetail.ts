import { useState, useCallback } from 'react'
import { adminOrdersReadonlyService, type AdminOrderReadonlyDetail, type AdminOrderMarkPaidSource, type AdminOrderMarkPaidResult } from '../../services/api/adminOrdersReadonly'
import { adminPrintJobsService } from '../../services/api/adminPrintJobs'
import { ApiHttpError } from '../../services/api/client'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { MARK_PAID_ERROR_TEXT } from './orderDisplay'

export function useOrderDetail(refresh: () => unknown) {
  const [detail, setDetail] = useState<AdminOrderReadonlyDetail | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  // 退款对话框状态
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundReason, setRefundReason] = useState('')
  const [refundSubmitting, setRefundSubmitting] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)

  // 线下 / 人工确认收款对话框状态（入口仅 payStatus==='unpaid' 可见；结论只认服务端返回）
  const [markPaidOpen, setMarkPaidOpen] = useState(false)
  const [markPaidSource, setMarkPaidSource] = useState<AdminOrderMarkPaidSource>('offline')
  const [markPaidSubmitting, setMarkPaidSubmitting] = useState(false)
  const [markPaidError, setMarkPaidError] = useState<string | null>(null)
  const [markPaidResult, setMarkPaidResult] = useState<AdminOrderMarkPaidResult | null>(null)

  // 废弃孤单对话框状态（仅 pending + claimedAt=null 任务可见）
  const [abandonConfirmOpen, setAbandonConfirmOpen] = useState(false)
  const [abandonSubmitting, setAbandonSubmitting] = useState(false)
  const [abandonError, setAbandonError] = useState<string | null>(null)
  const [verifyOpen, setVerifyOpen] = useState<'printed' | 'not_printed' | null>(null)
  const [verifyConfirm, setVerifyConfirm] = useState('')
  const [verifySubmitting, setVerifySubmitting] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const openDetail = async (id: string) => {
    setDetailState('loading')
    setDetail(null)
    // 收款结论只属于刚操作过的那一单，换单必须清掉，避免把上一单的入账结果显示在这一单上。
    setMarkPaidOpen(false)
    setMarkPaidSource('offline')
    setMarkPaidError(null)
    setMarkPaidResult(null)
    try {
      const data = await adminOrdersReadonlyService.getById(id)
      setDetail(data)
      setDetailState('ready')
    } catch {
      setDetailState('error')
    }
  }

  const closeDetail = () => {
    setDetail(null)
    setDetailState('idle')
    setRefundOpen(false)
    setRefundReason('')
    setRefundError(null)
    setMarkPaidOpen(false)
    setMarkPaidSource('offline')
    setMarkPaidError(null)
    setMarkPaidResult(null)
    setAbandonConfirmOpen(false)
    setAbandonError(null)
    setVerifyOpen(null)
    setVerifyConfirm('')
    setVerifyError(null)
  }

  const handleRefund = useCallback(async () => {
    if (!detail || !refundReason.trim()) return
    setRefundSubmitting(true)
    setRefundError(null)
    try {
      const result = await adminOrdersReadonlyService.refundOrder(detail.id, refundReason.trim())
      if (result.refund.status === 'failed') {
        setRefundError('渠道退款失败，订单未改状态，请稍后重试')
        return
      }
      setRefundOpen(false)
      setRefundReason('')
      void refresh()
      try {
        setDetail(await adminOrdersReadonlyService.getById(detail.id))
      } catch {
        /* 退款已受理；详情刷新失败不得显示成退款失败 */
      }
    } catch (err) {
      setRefundError(userMessageOf(err, '退款失败，请稍后重试'))
    } finally {
      setRefundSubmitting(false)
    }
  }, [detail, refundReason, refresh])

  const handleMarkPaid = useCallback(async () => {
    if (!detail) return
    setMarkPaidSubmitting(true)
    setMarkPaidError(null)
    setMarkPaidResult(null)
    try {
      // 入账结论完全取自服务端返回（payStatus / paymentSource / paidAt），前端不拼状态、不推断金额。
      const result = await adminOrdersReadonlyService.markPaidOrder(detail.id, markPaidSource)
      setMarkPaidResult(result)
      void refresh()
      const updated = await adminOrdersReadonlyService.getById(detail.id)
      setDetail(updated)
      setMarkPaidOpen(false)
    } catch (err) {
      const code = err instanceof ApiHttpError ? err.code : ''
      const hint = MARK_PAID_ERROR_TEXT[code]
      setMarkPaidError(hint ? `${hint}（${code}）` : code || '操作失败，请重试')
      // 失败常见于本地状态已过期（并发入账 / 退款），重拉一次服务端真值；
      // 重拉本身失败不覆盖上面的错误提示——收款失败必须留在页面上。
      try {
        setDetail(await adminOrdersReadonlyService.getById(detail.id))
      } catch { /* 保留原错误 */ }
    } finally {
      setMarkPaidSubmitting(false)
    }
  }, [detail, markPaidSource, refresh])

  const handleAbandon = useCallback(async () => {
    if (!detail?.printTaskId) return
    setAbandonSubmitting(true)
    setAbandonError(null)
    try {
      await adminPrintJobsService.abandonPending(detail.printTaskId)
      void refresh()
      const updated = await adminOrdersReadonlyService.getById(detail.id)
      setDetail(updated)
      setAbandonConfirmOpen(false)
    } catch (err) {
      const msg = userMessageOf(err, '操作失败，请重试')
      setAbandonError(msg)
    } finally {
      setAbandonSubmitting(false)
    }
  }, [detail, refresh])

  const handleVerifyOutcome = useCallback(async () => {
    if (!detail?.printTaskId || !verifyOpen) return
    setVerifySubmitting(true)
    setVerifyError(null)
    try {
      await adminPrintJobsService.verifyOutcome(detail.printTaskId, {
        outcome: verifyOpen,
        confirm: verifyConfirm.trim(),
      })
      void refresh()
      const updated = await adminOrdersReadonlyService.getById(detail.id)
      setDetail(updated)
      setVerifyOpen(null)
      setVerifyConfirm('')
    } catch (err) {
      setVerifyError(userMessageOf(err, '操作失败，请重试'))
    } finally {
      setVerifySubmitting(false)
    }
  }, [detail, refresh, verifyConfirm, verifyOpen])

  return { detail, detailState, refundOpen, setRefundOpen, refundReason, setRefundReason, refundSubmitting, refundError, setRefundError, markPaidOpen, setMarkPaidOpen, markPaidSource, setMarkPaidSource, markPaidSubmitting, markPaidError, setMarkPaidError, markPaidResult, setMarkPaidResult, abandonConfirmOpen, setAbandonConfirmOpen, abandonSubmitting, abandonError, setAbandonError, verifyOpen, setVerifyOpen, verifyConfirm, setVerifyConfirm, verifySubmitting, verifyError, setVerifyError, openDetail, closeDetail, handleRefund, handleMarkPaid, handleAbandon, handleVerifyOutcome }
}

export type OrderDetailControls = ReturnType<typeof useOrderDetail>
