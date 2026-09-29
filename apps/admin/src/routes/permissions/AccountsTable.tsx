// 内部账号名册表格。行级操作判定在 presentation.ts 的 rowActionFor：
// admin 启停（自己 / 最后一个启用管理员禁用并说明）、partner 跳机构页、kiosk 只读。

import { StatusBadge } from '@ai-job-print/ui'
import { Link } from 'react-router-dom'
import type { InternalAccountItem } from '../../services/api/internalAccounts'
import {
  PASSWORD_STATE_LABELS,
  ROLE_LABELS,
  accountDisplayName,
  formatBeijingDate,
  formatBeijingDateTime,
  phoneCellText,
  rowActionFor,
} from './presentation'

const COLUMNS = ['账号', '角色', '所属机构', '状态', '手机号', '密码状态', '最后登录', '创建时间', '操作'] as const

export interface AccountsTableProps {
  items: InternalAccountItem[]
  currentUserId: string | null
  /** 当前启用管理员的真实总数（额外一次 role=admin&enabled=true 查询的 total）；null = 未知。 */
  enabledAdminTotal: number | null
  onSetStatus: (item: InternalAccountItem, intent: 'enable' | 'disable', trigger: HTMLButtonElement) => void
}

export function AccountsTable({ items, currentUserId, enabledAdminTotal, onSetStatus }: AccountsTableProps) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-100 bg-neutral-50/70 text-left text-xs font-medium text-neutral-500">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} className="whitespace-nowrap px-4 py-3">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {items.map((item) => (
            <RosterRow
              key={item.id}
              item={item}
              currentUserId={currentUserId}
              enabledAdminTotal={enabledAdminTotal}
              onSetStatus={onSetStatus}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RosterRow({
  item,
  currentUserId,
  enabledAdminTotal,
  onSetStatus,
}: {
  item: InternalAccountItem
  currentUserId: string | null
  enabledAdminTotal: number | null
  onSetStatus: AccountsTableProps['onSetStatus']
}) {
  const action = rowActionFor(item, currentUserId, enabledAdminTotal)
  return (
    <tr className="text-neutral-700 hover:bg-neutral-50/70">
      <td className="px-4 py-3">
        <div className="font-medium text-neutral-900">{item.username}</div>
        <div className="text-xs text-neutral-400">{accountDisplayName(item)}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            status={item.role === 'admin' ? 'info' : item.role === 'partner' ? 'success' : 'default'}
            label={ROLE_LABELS[item.role] ?? item.role}
          />
          {item.isBackupAdmin && (
            <StatusBadge status="warning" dot label="备用管理员" />
          )}
        </div>
      </td>
      <td className="max-w-40 truncate px-4 py-3" title={item.orgName ?? undefined}>
        {item.orgName ?? <span className="text-neutral-400">—</span>}
      </td>
      <td className="px-4 py-3">
        <StatusBadge dot status={item.enabled ? 'success' : 'error'} label={item.enabled ? '启用' : '停用'} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
        {phoneCellText(item)}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        {PASSWORD_STATE_LABELS[item.passwordState] ?? item.passwordState}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
        {formatBeijingDateTime(item.lastLoginAt)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
        {formatBeijingDate(item.createdAt)}
      </td>
      <td className="px-4 py-3">
        <RowActionCell item={item} action={action} onSetStatus={onSetStatus} />
      </td>
    </tr>
  )
}

function RowActionCell({
  item,
  action,
  onSetStatus,
}: {
  item: InternalAccountItem
  action: ReturnType<typeof rowActionFor>
  onSetStatus: AccountsTableProps['onSetStatus']
}) {
  if (action.kind === 'partner-link') {
    const target = action.orgName ? `/partners?search=${encodeURIComponent(action.orgName)}` : '/partners'
    return (
      <Link
        to={target}
        title={`合作机构账号的启用停用在「合作机构管理」里操作${action.orgName ? `，点击后按「${action.orgName}」筛选定位` : ''}`}
        className="flex min-h-12 items-center rounded-lg px-3 text-sm font-medium text-primary-700 hover:bg-primary-50"
      >
        去机构页处理
      </Link>
    )
  }
  if (action.kind === 'readonly') {
    return (
      <span className="flex min-h-12 items-center text-xs text-neutral-400" title="终端账号不在本页管理">
        只读
      </span>
    )
  }
  const intent = action.enabled ? 'disable' : 'enable'
  const label = action.enabled ? '停用' : '启用'
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={action.disabled}
        title={action.disabled ? action.reason : undefined}
        aria-label={`${label}账号 ${item.username}`}
        aria-disabled={action.disabled}
        onClick={(event) => {
          if (!action.disabled) onSetStatus(item, intent, event.currentTarget)
        }}
        className={`flex min-h-12 items-center rounded-lg px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
          action.enabled ? 'text-red-600 hover:bg-red-50' : 'text-primary-700 hover:bg-primary-50'
        }`}
      >
        {label}
      </button>
      {action.disabled && <span className="text-xs text-neutral-400">{action.reason}</span>}
    </div>
  )
}
