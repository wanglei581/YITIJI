import { useCallback, useEffect, useState } from 'react'
import type { FirstOrderIncidentDirectoryItem, FirstOrderReportDirectoryItem } from '@ai-job-print/shared'
import { firstOrderApi } from '../../services/api/firstOrder'
import { adminPrintScanService } from '../../services/api/printScan'
import {
  countIncidentStatuses,
  earliestIncidents,
  groupByOrg,
  isPreviewFailure,
  missingReports,
  unacknowledgedReports,
} from './serviceQueueModel'

export type QueueState<T> =
  | { status: 'loading' }
  | { status: 'preview' }
  | { status: 'error' }
  | { status: 'ready'; data: T }

export interface IncidentQueue {
  total: number
  open: number
  processing: number
  resolved: number
  earliest: FirstOrderIncidentDirectoryItem[]
  truncated: boolean
  shown: number
  /** 列表被截断时无法给出完整的分机构数量，此时为 null。 */
  orgCounts: { orgId: string; orgName: string; count: number }[] | null
}

export interface ReportQueue {
  month: string
  truncated: boolean
  missing: FirstOrderReportDirectoryItem[]
  awaitingAck: number
}

function useAttempt(): [number, () => void] {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((current) => current + 1), [])
  return [attempt, retry]
}

export function useIncidentQueue(): { state: QueueState<IncidentQueue>; retry: () => void } {
  const [attempt, retry] = useAttempt()
  const [state, setState] = useState<QueueState<IncidentQueue>>({ status: 'loading' })
  useEffect(() => {
    const control = new AbortController()
    let alive = true
    setState({ status: 'loading' })
    void (async () => {
      const directory = await firstOrderApi.listIncidents(undefined, control.signal)
      let counts = countIncidentStatuses(directory.items)
      if (directory.truncated) {
        const [open, processing, resolved] = await Promise.all([
          firstOrderApi.listIncidents({ status: 'open', limit: 1 }, control.signal),
          firstOrderApi.listIncidents({ status: 'processing', limit: 1 }, control.signal),
          firstOrderApi.listIncidents({ status: 'resolved', limit: 1 }, control.signal),
        ])
        counts = { open: open.total, processing: processing.total, resolved: resolved.total }
      }
      const earliest = earliestIncidents(directory.items)
      return {
        total: directory.total,
        ...counts,
        earliest,
        truncated: directory.truncated,
        shown: earliest.length,
        orgCounts: directory.truncated ? null : groupByOrg(directory.items),
      }
    })().then((data) => {
      if (alive) setState({ status: 'ready', data })
    }).catch((error: unknown) => {
      if (!alive || control.signal.aborted) return
      setState(isPreviewFailure(error) ? { status: 'preview' } : { status: 'error' })
    })
    return () => {
      alive = false
      control.abort()
    }
  }, [attempt])
  return { state, retry }
}

export function useReportQueue(): { state: QueueState<ReportQueue>; retry: () => void } {
  const [attempt, retry] = useAttempt()
  const [state, setState] = useState<QueueState<ReportQueue>>({ status: 'loading' })
  useEffect(() => {
    const control = new AbortController()
    let alive = true
    setState({ status: 'loading' })
    firstOrderApi.listMonthlyReports(undefined, control.signal).then((directory) => {
      if (!alive) return
      const missing = missingReports(directory.items)
      setState({
        status: 'ready',
        data: {
          month: directory.month,
          truncated: directory.truncated,
          missing,
          awaitingAck: unacknowledgedReports(directory.items).length,
        },
      })
    }).catch((error: unknown) => {
      if (!alive || control.signal.aborted) return
      setState(isPreviewFailure(error) ? { status: 'preview' } : { status: 'error' })
    })
    return () => {
      alive = false
      control.abort()
    }
  }, [attempt])
  return { state, retry }
}

export function useUnconfirmedPrintCount(): { state: QueueState<number>; retry: () => void } {
  const [attempt, retry] = useAttempt()
  const [state, setState] = useState<QueueState<number>>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    adminPrintScanService.listTasks({ type: 'print', unconfirmed: true, page: 1, pageSize: 1 }).then((page) => {
      if (!alive) return
      if (typeof page.pagination?.total !== 'number') {
        setState({ status: 'error' })
        return
      }
      setState({ status: 'ready', data: page.pagination.total })
    }).catch((error: unknown) => {
      if (!alive) return
      setState(isPreviewFailure(error) ? { status: 'preview' } : { status: 'error' })
    })
    return () => { alive = false }
  }, [attempt])
  return { state, retry }
}
