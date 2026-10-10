import type { ElementType } from 'react'
import { formatCount, formatDateTime, formatRelativeTime } from '@ai-job-print/shared'
import { BotIcon, Building2Icon, FolderIcon, MonitorIcon, PrinterIcon, FileWarningIcon, MessageSquareWarningIcon } from 'lucide-react'
import type { AdminFileRecord } from '../../services/api'
import type { AdminAlertItem } from '../../services/api/adminOps'
import type { StockTodo } from './recruitmentStock'
import type { TodoRow } from './DashboardWidgets'

interface LoadedSources {
  /** 招聘类存量一行（3.15：不再有「待审核 / 去审核」，见 recruitmentStock.ts）；null = 不显示 */
  recruitmentStock: StockTodo | null
  files: AdminFileRecord[]
}

export function fileAttention(files: AdminFileRecord[]): { expired: number; sensitive: number } {
  const now = Date.now()
  const activeFiles = files.filter((file) => file.deletedAt === null)
  return {
    expired: activeFiles.filter((file) => file.expiresAt !== null && Date.parse(file.expiresAt) <= now).length,
    sensitive: activeFiles.filter((file) => file.sensitiveLevel === 'highly_sensitive').length,
  }
}

export function buildTodoRows(loaded: LoadedSources): TodoRow[] {
  const rows: TodoRow[] = []
  const fileStats = fileAttention(loaded.files)

  if (loaded.recruitmentStock) rows.push(loaded.recruitmentStock)
  if (fileStats.expired > 0) {
    rows.push({
      key: 'files',
      icon: FolderIcon,
      title: `${formatCount(fileStats.expired)} 个已过期在库文件`,
      sub: '近 100 条内 · 建议执行清理',
      href: '/files',
      actionLabel: '去清理',
      warn: true,
    })
  }
  if (fileStats.sensitive > 0) {
    rows.push({
      key: 'sensitive',
      icon: Building2Icon,
      title: `${formatCount(fileStats.sensitive)} 个高敏文件在库`,
      sub: '近 100 条内 · 关注保留时长与访问日志',
      href: '/files',
      actionLabel: '去查看',
      warn: true,
    })
  }
  return rows
}

const ALERT_ROW_ICON: Record<AdminAlertItem['type'], ElementType> = {
  terminal_offline: MonitorIcon,
  printer_issue: PrinterIcon,
  print_failed: PrinterIcon,
  paid_pending_file_unavailable: FileWarningIcon,
  feedback_pending: MessageSquareWarningIcon,
  print_terminal_quota_high: PrinterIcon,
  ai_provider_unavailable: BotIcon,
  ai_consecutive_failures: BotIcon,
  ai_budget_exhausted: BotIcon,
}

/**
 * 已支付但文件不可用的任务排在最前：后端按发生时间倒序，文件状态较早变化的这类告警
 * 会被新近的离线/失败告警挤出前 3 条，而它涉及已付款订单、只能人工处置。
 */
export function buildAlertRows(alerts: AdminAlertItem[]): TodoRow[] {
  const paidPending = alerts.filter((alert) => alert.type === 'paid_pending_file_unavailable')
  const others = alerts.filter((alert) => alert.type !== 'paid_pending_file_unavailable')
  return [...paidPending, ...others].slice(0, 3).map((alert) => ({
    key: alert.id,
    icon: ALERT_ROW_ICON[alert.type] ?? PrinterIcon,
    title: alert.title,
    sub: alert.type === 'paid_pending_file_unavailable'
      ? `已支付 · 需人工处置 · ${alert.terminalCode ?? '未知终端'} · ${formatRelativeTime(alert.occurredAt)}`
      // 意见反馈不挂在终端上，terminalCode 为空时不能写成「未知终端」
      : alert.type === 'feedback_pending'
        ? `意见反馈 · ${formatRelativeTime(alert.occurredAt)}`
        : alert.type === 'ai_provider_unavailable' || alert.type === 'ai_consecutive_failures' || alert.type === 'ai_budget_exhausted'
          ? `AI 服务 · ${formatRelativeTime(alert.occurredAt)}`
          : `${alert.terminalCode ?? '未知终端'} · ${formatRelativeTime(alert.occurredAt)}`,
    href: alert.type === 'feedback_pending' ? '/member-feedback?category=ai_content' : '/alerts',
    timeTitle: formatDateTime(alert.occurredAt, { fallback: '' })
      ? `发生时间 ${formatDateTime(alert.occurredAt)}`
      : undefined,
    actionLabel: '处理',
    warn: true,
  }))
}

