// 内部账号名册表格。行级操作判定在 presentation.ts 的 rowActionFor：
// admin 启停（自己 / 最后一个启用管理员禁用并说明）、partner 跳机构页、kiosk 只读。

import { ConsoleTable, StatusBadge, type ConsoleTableProps } from '@ai-job-print/ui'
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

export interface AccountsTableProps extends Pick<ConsoleTableProps<InternalAccountItem>, 'page' | 'pageSize' | 'total' | 'onPageChange' | 'onPageSizeChange' | 'loading' | 'error' | 'empty'> {
  items: InternalAccountItem[]
  currentUserId: string | null
  /** 当前启用管理员的真实总数（额外一次 role=admin&enabled=true 查询的 total）；null = 未知。 */
  enabledAdminTotal: number | null
  onSetStatus: (item: InternalAccountItem, intent: 'enable' | 'disable', trigger: HTMLButtonElement) => void
}

export function AccountsTable({ items, currentUserId, enabledAdminTotal, onSetStatus, ...table }: AccountsTableProps) {
  return <ConsoleTable {...table} items={items} columns={[
    { id: 'account', header: '账号', truncate: true, title: (item) => `${item.username} · ${accountDisplayName(item)}`, cell: (item) => <div><p title={item.username} className="max-w-40 truncate font-medium">{item.username}</p><p title={accountDisplayName(item)} className="max-w-40 truncate text-xs text-neutral-400">{accountDisplayName(item)}</p></div> },
    { id: 'role', header: '角色', cell: (item) => <div className="flex flex-wrap gap-1.5"><StatusBadge status={item.role === 'admin' ? 'info' : item.role === 'partner' ? 'success' : 'default'} label={ROLE_LABELS[item.role] ?? item.role} />{item.isBackupAdmin && <StatusBadge status="warning" dot label="备用管理员" />}</div> },
    { id: 'org', header: '所属机构', truncate: true, cell: (item) => item.orgName ?? '—' },
    { id: 'status', header: '状态', cell: (item) => <StatusBadge dot status={item.enabled ? 'success' : 'error'} label={item.enabled ? '启用' : '停用'} /> },
    { id: 'phone', header: '手机号', cellClassName: 'whitespace-nowrap font-mono text-xs', cell: phoneCellText },
    { id: 'password', header: '密码状态', cellClassName: 'whitespace-nowrap text-xs', cell: (item) => PASSWORD_STATE_LABELS[item.passwordState] ?? item.passwordState },
    { id: 'login', header: '最后登录', cellClassName: 'whitespace-nowrap text-xs', cell: (item) => formatBeijingDateTime(item.lastLoginAt) },
    { id: 'created', header: '创建时间', cellClassName: 'whitespace-nowrap text-xs', cell: (item) => formatBeijingDate(item.createdAt) },
    { id: 'actions', header: '操作', sticky: true, cellClassName: 'whitespace-nowrap', cell: (item) => <RowActionCell item={item} action={rowActionFor(item, currentUserId, enabledAdminTotal)} onSetStatus={onSetStatus} /> },
  ]} />
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
